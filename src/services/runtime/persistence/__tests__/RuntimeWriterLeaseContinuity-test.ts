import fs from "fs";
import path from "path";

import {
  runtimeWriterAppStateAction,
  startRuntimeWriterRenewalLoop,
} from "@/services/RuntimeCheckpointSyncService";
import { nativeLeaseHeartbeatContext } from "@/services/runtime/persistence/RuntimeNativeLeaseHeartbeat";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";

const lease = (expiresAt = "2099-09-18T12:00:00.000Z"): RuntimeWriterLease => Object.freeze({
  exerciseId: "EX-CONTINUITY",
  leaseId: "00000000-0000-4000-8000-000000000001",
  writerInstanceId: "runtime-continuity",
  userId: "00000000-0000-4000-8000-000000000002",
  expiresAt,
});

describe("Runtime writer lease continuity", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("sustains one writer through several renewal periods while idle and during durable work", async () => {
    jest.useFakeTimers();
    let current = lease();
    let concurrent = 0;
    let maximumConcurrent = 0;
    const renew = jest.fn(async () => {
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      return { status: "ALREADY_OWNED" as const, lease: current, checkpointRevision: 12 };
    });
    const onRevoked = jest.fn();
    const durableWork = jest.fn();
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => current,
      isWriter: () => true,
      renew,
      onRenewed: (_prior, refreshed) => { current = refreshed; },
      onTransientFailure: jest.fn(),
      onRevoked,
      intervalMs: 20,
    });

    await jest.advanceTimersByTimeAsync(40);
    durableWork();
    await jest.advanceTimersByTimeAsync(80);

    expect(renew).toHaveBeenCalledTimes(6);
    expect(durableWork).toHaveBeenCalledTimes(1);
    expect(maximumConcurrent).toBe(1);
    expect(onRevoked).not.toHaveBeenCalled();
    expect(loop.isActive()).toBe(true);
    loop.stop();
  });

  test("transient renewal failures retain one scheduler and later recover", async () => {
    jest.useFakeTimers();
    let current = lease();
    const renew = jest.fn()
      .mockResolvedValueOnce({ status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" })
      .mockResolvedValueOnce({ status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" })
      .mockResolvedValue({ status: "ALREADY_OWNED", lease: current, checkpointRevision: 12 });
    const onTransientFailure = jest.fn();
    const onRevoked = jest.fn();
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => current,
      isWriter: () => true,
      renew,
      onRenewed: (_prior, refreshed) => { current = refreshed; },
      onTransientFailure,
      onRevoked,
      intervalMs: 20,
    });

    await jest.advanceTimersByTimeAsync(80);

    expect(onTransientFailure).toHaveBeenCalledTimes(2);
    expect(renew).toHaveBeenCalledTimes(4);
    expect(onRevoked).not.toHaveBeenCalled();
    expect(loop.isActive()).toBe(true);
    loop.stop();
  });

  test("genuine expiry revokes locally before another renewal attempt", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-18T08:01:01.000Z") });
    const expired = lease("2026-09-18T08:01:00.000Z");
    const renew = jest.fn();
    const onRevoked = jest.fn();
    const loop = startRuntimeWriterRenewalLoop({
      getLease: () => expired,
      isWriter: () => true,
      renew,
      onRenewed: jest.fn(),
      onTransientFailure: jest.fn(),
      onRevoked,
      intervalMs: 20,
    });

    await jest.advanceTimersByTimeAsync(20);

    expect(renew).not.toHaveBeenCalled();
    expect(onRevoked).toHaveBeenCalledWith(expired, "WRITER_LEASE_EXPIRED");
    expect(loop.isActive()).toBe(false);
  });

  test("native context carries a bounded monotonic-TTL seed without credentials in diagnostics", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-18T08:00:30.000Z"));
    const context = nativeLeaseHeartbeatContext(
      lease("2026-09-18T08:01:00.000Z"),
      "heartbeat-generation",
      60,
      { accessToken: "secret", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "publishable" },
    );
    expect(context.leaseRemainingMs).toBe(30_000);
    expect(context.heartbeatGeneration).toBe("heartbeat-generation");
  });

  test("native transport keeps the periodic scheduler after retryable network failure and fails closed at expiry", () => {
    const nativeSource = fs.readFileSync(path.join(
      process.cwd(),
      "native/android/RuntimeNativeLeaseHeartbeatModule.kt",
    ), "utf8");
    const syncSource = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");

    expect(nativeSource).toContain("executor.scheduleAtFixedRate");
    expect(nativeSource).toContain("handleNetworkFailure(heartbeat, retry)");
    expect(nativeSource).toContain("if (!retry) scheduleBoundedRetry(heartbeat)");
    expect(nativeSource).toContain("SystemClock.elapsedRealtime() >= heartbeat.confirmedUntilElapsedRealtimeMs");
    expect(nativeSource).toContain('stopForFailure(heartbeat, "WRITER_LEASE_EXPIRED")');
    expect(nativeSource).not.toContain('if (!retry) scheduleBoundedRetry(heartbeat) else stopForFailure(heartbeat, "NETWORK_FAILURE")');
    expect(syncSource).toContain('if (diagnostic.state === "STOPPED" && diagnostic.lastFailure)');
    expect(syncSource).not.toContain('diagnostic.lastFailure !== "NETWORK_FAILURE"');
  });

  test("app lifecycle preserves background authority and reconciles on foreground", () => {
    expect(runtimeWriterAppStateAction("background")).toBe("PRESERVE");
    expect(runtimeWriterAppStateAction("inactive")).toBe("PRESERVE");
    expect(runtimeWriterAppStateAction("active")).toBe("RECONCILE");
  });
});
