package com.jaaklind.RussiCaptor

import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Process-scoped scheduler only. It never creates authority: every renewal is
 * still decided by public.renew_runtime_writer using the authenticated caller.
 */
class RuntimeNativeLeaseHeartbeatModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val lock = Any()
  private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "RussiCaptorLeaseHeartbeat").apply { isDaemon = true }
  }
  private var active: Heartbeat? = null
  private var task: ScheduledFuture<*>? = null

  override fun getName() = "RuntimeNativeLeaseHeartbeat"

  @ReactMethod
  fun start(input: ReadableMap, promise: Promise) {
    val heartbeat = try { Heartbeat.from(input) } catch (_: Exception) {
      promise.reject("INVALID_HEARTBEAT_CONTEXT", "Invalid native lease heartbeat context")
      return
    }
    synchronized(lock) {
      val existing = active
      if (existing?.generation == heartbeat.generation && existing.leaseId == heartbeat.leaseId && existing.writerInstanceId == heartbeat.writerInstanceId) {
        promise.resolve(diagnosticMap(existing))
        return
      }
      cancelLocked("REPLACED")
      active = heartbeat
      task = executor.scheduleAtFixedRate({ tick(heartbeat.generation, false) }, HEARTBEAT_INTERVAL_SECONDS, HEARTBEAT_INTERVAL_SECONDS, TimeUnit.SECONDS)
      emit("NATIVE_HEARTBEAT_STARTED", heartbeat, "ACTIVE")
      promise.resolve(diagnosticMap(heartbeat))
    }
  }

  @ReactMethod
  fun updateAccessToken(generation: String, accessToken: String, promise: Promise) {
    synchronized(lock) {
      val heartbeat = active
      if (heartbeat == null || heartbeat.generation != generation || accessToken.isBlank()) {
        promise.reject("HEARTBEAT_NOT_ACTIVE", "Native heartbeat is not active")
        return
      }
      heartbeat.accessToken = accessToken
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun stop(generation: String, reason: String, promise: Promise) {
    synchronized(lock) {
      if (active?.generation == generation) cancelLocked(reason.ifBlank { "EXPLICIT_STOP" })
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun getDiagnosticState(promise: Promise) {
    synchronized(lock) { promise.resolve(active?.let(::diagnosticMap) ?: idleMap()) }
  }

  private fun tick(generation: String, retry: Boolean) {
    val heartbeat = synchronized(lock) { active?.takeIf { it.generation == generation } } ?: return
    synchronized(lock) { if (active?.generation == generation) heartbeat.state = "RENEWING" }
    emit("NATIVE_HEARTBEAT_TICK", heartbeat, "RENEWING")
    val startedAt = SystemClock.elapsedRealtime()
    try {
      val connection = (URL("${heartbeat.supabaseUrl.trimEnd('/')}/rest/v1/rpc/renew_runtime_writer").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = REQUEST_TIMEOUT_MS
        readTimeout = REQUEST_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("apikey", heartbeat.publishableKey)
        setRequestProperty("Authorization", "Bearer ${heartbeat.accessToken}")
      }
      val request = JSONObject().apply {
        put("p_lease_id", heartbeat.leaseId)
        put("p_writer_instance_id", heartbeat.writerInstanceId)
        put("p_lease_seconds", heartbeat.leaseSeconds)
      }.toString().toByteArray(StandardCharsets.UTF_8)
      connection.outputStream.use { it.write(request) }
      val status = connection.responseCode
      val response = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
      connection.disconnect()
      if (status in 200..299) {
        val expiresAt = parseExpiresAt(response)
        synchronized(lock) {
          if (active?.generation != generation) return
          heartbeat.state = "ACTIVE"
          heartbeat.lastSuccessExpiresAt = expiresAt
          // The server starts the renewed TTL before returning. Anchoring the
          // local fail-closed deadline at request start is conservative and
          // avoids wall-clock skew while still allowing later native retries.
          heartbeat.confirmedUntilElapsedRealtimeMs = startedAt + heartbeat.leaseSeconds * 1_000L
          heartbeat.lastFailure = null
          heartbeat.retryScheduled = false
        }
        emit("NATIVE_RENEW_RPC_SUCCESS", heartbeat, "ACTIVE", SystemClock.elapsedRealtime() - startedAt)
        return
      }
      val failure = serverFailure(status, response)
      val reportedFailure = if (failure == "NETWORK_FAILURE") {
        handleNetworkFailure(heartbeat, retry)
      } else {
        stopForFailure(heartbeat, failure)
        failure
      }
      emit("NATIVE_RENEW_RPC_FAILURE", heartbeat, reportedFailure, SystemClock.elapsedRealtime() - startedAt)
    } catch (_: Exception) {
      val failure = handleNetworkFailure(heartbeat, retry)
      emit("NATIVE_RENEW_RPC_FAILURE", heartbeat, failure, SystemClock.elapsedRealtime() - startedAt)
    }
  }

  /**
   * A transient transport failure must not cancel the process-scoped periodic
   * heartbeat. One early retry is still scheduled, and later fixed-rate ticks
   * remain available for recovery. Once the last server-confirmed TTL has
   * elapsed, the writer fails closed instead of retaining false WRITE_READY.
   */
  private fun handleNetworkFailure(heartbeat: Heartbeat, retry: Boolean): String {
    val expired = synchronized(lock) {
      if (active?.generation != heartbeat.generation) return "STALE_HEARTBEAT"
      heartbeat.state = "ACTIVE"
      heartbeat.lastFailure = "NETWORK_FAILURE"
      if (retry) heartbeat.retryScheduled = false
      SystemClock.elapsedRealtime() >= heartbeat.confirmedUntilElapsedRealtimeMs
    }
    if (expired) {
      stopForFailure(heartbeat, "WRITER_LEASE_EXPIRED")
      return "WRITER_LEASE_EXPIRED"
    }
    if (!retry) scheduleBoundedRetry(heartbeat)
    return "NETWORK_FAILURE"
  }

  private fun scheduleBoundedRetry(heartbeat: Heartbeat) {
    synchronized(lock) {
      if (active?.generation != heartbeat.generation || heartbeat.retryScheduled) return
      heartbeat.retryScheduled = true
      heartbeat.lastFailure = "NETWORK_FAILURE"
      executor.schedule({ tick(heartbeat.generation, true) }, RETRY_DELAY_SECONDS, TimeUnit.SECONDS)
    }
  }

  private fun stopForFailure(heartbeat: Heartbeat, failure: String) {
    synchronized(lock) {
      if (active?.generation != heartbeat.generation) return
      heartbeat.state = "FAILED"
      heartbeat.lastFailure = failure
      cancelLocked(failure)
    }
  }

  private fun cancelLocked(reason: String) {
    val heartbeat = active ?: return
    task?.cancel(true)
    task = null
    active = null
    heartbeat.state = "STOPPED"
    emit("NATIVE_HEARTBEAT_STOPPED", heartbeat, reason)
  }

  private fun emit(event: String, heartbeat: Heartbeat, result: String, latencyMs: Long? = null) {
    // Never include token, lease ID, writer ID, exercise ID, or server payload in logs/events.
    val map = Arguments.createMap().apply {
      putString("state", heartbeat.state)
      putString("heartbeatGeneration", heartbeat.generation)
      heartbeat.lastSuccessExpiresAt?.let { putString("lastSuccessExpiresAt", it) }
      heartbeat.lastFailure?.let { putString("lastFailure", it) }
      putString("event", event)
      putString("result", result)
      latencyMs?.let { putDouble("latencyMs", it.toDouble()) }
    }
    try { context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("RuntimeNativeLeaseHeartbeat", map) } catch (_: Exception) { }
    Log.i(LOG_TAG, "$event generation=${heartbeat.generation} result=$result${latencyMs?.let { " latencyMs=$it" } ?: ""}")
  }

  private fun diagnosticMap(heartbeat: Heartbeat) = Arguments.createMap().apply {
    putString("state", heartbeat.state)
    putString("heartbeatGeneration", heartbeat.generation)
    heartbeat.lastSuccessExpiresAt?.let { putString("lastSuccessExpiresAt", it) }
    heartbeat.lastFailure?.let { putString("lastFailure", it) }
  }
  private fun idleMap() = Arguments.createMap().apply { putString("state", "IDLE") }

  private fun parseExpiresAt(response: String): String? {
    val values = JSONArray(response)
    return if (values.length() > 0) values.getJSONObject(0).optString("expires_at").ifBlank { null } else null
  }

  private fun serverFailure(status: Int, response: String): String = when {
    status == 401 || status == 403 -> "AUTHORIZATION_DENIED"
    response.contains("STALE_WRITER", ignoreCase = true) -> "STALE_WRITER"
    response.contains("WRITER_AUTHORITY_HELD", ignoreCase = true) -> "NOT_WRITER"
    status >= 500 -> "NETWORK_FAILURE"
    else -> "SERVER_REJECTED"
  }

  private class Heartbeat(
    val generation: String,
    val leaseId: String,
    val exerciseId: String,
    val writerInstanceId: String,
    val leaseSeconds: Int,
    val leaseRemainingMs: Long,
    val supabaseUrl: String,
    val publishableKey: String,
    var accessToken: String,
    var state: String = "ACTIVE",
    var lastSuccessExpiresAt: String? = null,
    var lastFailure: String? = null,
    var retryScheduled: Boolean = false,
    var confirmedUntilElapsedRealtimeMs: Long = SystemClock.elapsedRealtime() + leaseRemainingMs,
  ) {
    companion object {
      fun from(input: ReadableMap) = Heartbeat(
        input.getString("heartbeatGeneration") ?: throw IllegalArgumentException(),
        input.getString("leaseId") ?: throw IllegalArgumentException(),
        input.getString("exerciseId") ?: throw IllegalArgumentException(),
        input.getString("writerInstanceId") ?: throw IllegalArgumentException(),
        input.getInt("leaseSeconds"),
        input.getDouble("leaseRemainingMs").toLong().coerceIn(0L, input.getInt("leaseSeconds") * 1_000L),
        input.getString("supabaseUrl") ?: throw IllegalArgumentException(),
        input.getString("supabasePublishableKey") ?: throw IllegalArgumentException(),
        input.getString("accessToken") ?: throw IllegalArgumentException(),
      )
    }
  }

  companion object {
    private const val LOG_TAG = "RussiCaptorLease"
    private const val HEARTBEAT_INTERVAL_SECONDS = 20L
    private const val RETRY_DELAY_SECONDS = 5L
    private const val REQUEST_TIMEOUT_MS = 8_000
  }

  override fun invalidate() {
    synchronized(lock) { cancelLocked("REACT_CONTEXT_DESTROYED") }
    executor.shutdownNow()
    super.invalidate()
  }
}
