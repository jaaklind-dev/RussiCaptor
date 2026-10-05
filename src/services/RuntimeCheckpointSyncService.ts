import type { RealtimeChannel } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import type { CheckpointAuthorityDiagnosticCode, RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import {
  acceptAuthoritativeRuntimeCheckpointAsync,
  acceptAuthoritativeRuntimeCheckpointForReaderAsync,
  ensureLocalRuntimeCheckpoint,
  getLocalRuntimeCheckpoint,
  subscribeToLocalRuntimeCheckpointPrepared,
} from "@/services/StatePersistenceService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { supabase } from "@/services/SupabaseService";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { notifySync, subscribeToSync } from "@/services/SyncService";
import { isValidRuntimeCheckpoint, localRuntimeCheckpointStore, resolveAuthoritativeCheckpointAsync, resolveSubscribedCheckpoint, resolveWriterCandidateCheckpoint, type RuntimeWriterCandidateCheckpointResolution } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { yieldToEventLoop } from "@/services/runtime/persistence/LatestGenerationPipeline";
import {
  SupabaseRuntimeCheckpointRepository,
  loadCheckpointFreshness,
  type RuntimeCheckpointRepository,
} from "@/services/runtime/persistence/RuntimeCheckpointRepository";
import { interceptRuntimeCheckpointPublicationResponseForValidation } from "@/services/runtime/persistence/RuntimeCheckpointPublicationValidationHarness";
import { getRuntimeWriterInstanceId } from "@/services/runtime/persistence/RuntimeWriterIdentityService";
import { runtimeWritesAllowed, setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { publishRuntimeCheckpointTerminal, type RuntimeCheckpointPublicationTerminal } from "@/services/runtime/persistence/RuntimeCheckpointPublicationService";
import { getCloudSyncStatus, isRemoteRuntimeLifecycleActive, subscribeToCloudSyncStatus, waitForRemoteRuntimeLifecycleActive } from "@/services/CloudSyncService";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { parseRuntimeCheckpointMetadata, RuntimeCheckpointMetadataCoordinator } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import { loadRuntimeCheckpointWithCache } from "@/services/runtime/persistence/RuntimeCheckpointHydrationService";
import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { getRuntimeLeaseLifecycleTrace, nextRuntimeLeaseTraceLabel, startRuntimeWorkTrace, traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { getNativeLeaseHeartbeatDiagnostic, isNativeLeaseHeartbeatAvailable } from "@/services/runtime/persistence/RuntimeNativeLeaseHeartbeat";
import { RuntimeNativeLeaseHeartbeatController, type NativeLeaseHeartbeatSession } from "@/services/runtime/persistence/RuntimeNativeLeaseHeartbeatController";
import { installRuntimeCompletionIntentListener } from "@/services/runtime/persistence/RuntimeCheckpointLifecycleIntent";
import { RuntimePatientCommandConsumer, getRuntimePatientCommandGateway } from "@/services/runtime/commands/RuntimePatientCommandService";
import { checkpointHasCanonicalEttMaterialization } from
  "@/services/runtime/commands/EndotrachealIntubationCanonicalCommit";
import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import { getAllPatients } from "@/repositories/PatientRepository";
import { ensureSharedWorkflowPatientHeads } from "@/services/sharedWorkflow/SharedWorkflowHeadInitializationService";
import { materializeRuntimePatientCommand } from "@/services/runtime/commands/RuntimePatientCommandMaterializer";
import { getRuntimePatientCommandCursor } from "@/services/runtime/commands/RuntimePatientCommandCursor";
import { getRuntimeCompletionGateway, setRuntimeCompletionPhase } from "@/services/runtime/exercise/RuntimeCompletionService";
import type { RuntimeCompletionRequest } from "@/models/RuntimeCompletion";
import { handleExerciseControlCommand } from "@/services/runtime/exercise/ExerciseControlCommandHandler";
import { RuntimeExerciseOwnerGeneration } from "@/services/runtime/exercise/RuntimeExerciseOwnerGeneration";
import {
  acceptRuntimeReaderCheckpoint,
  advertiseRuntimeReaderCheckpoint,
  beginRuntimeReaderConvergence,
  resetRuntimeReaderConvergence,
  setRuntimeCommandAuthorityWriter,
  setRuntimeReaderConvergenceUnavailable,
} from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import {
  getOperatorSession,
  hasActiveRole,
  subscribeOperatorSession,
  type OperatorSessionState,
} from "@/services/authorization/OperatorSessionService";
import { getExercisePackageBindingVersion, subscribeToExercisePackageBindings } from "@/services/exercise/ExercisePackageService";
import { registerOperatorSignOutPreparation } from "@/services/authorization/OperatorSignOutLifecycle";

const LEASE_SECONDS = 60;
const RENEW_MS = 20_000;
export const ROUTINE_CHECKPOINT_PUBLICATION_MS = 5_000;
const STARTUP_TIMEOUT_MS = 8_000;
type Status = Readonly<{ state: "DISABLED"|"CONNECTING"|"ACQUIRING"|"WRITER"|"READER"|"OFFLINE"|"CONFLICT"|"FAILED"; code?: string; revision?: number }>;
type SyncIdentity = Readonly<{ exerciseId: string; activeLifecycle: boolean }>;
export type RuntimeBootstrapRetrySignal = Readonly<{
  exerciseId: string;
  activeLifecycle: boolean;
  scopedAuthorityReady: boolean;
  packageBindingVersion: number;
  cloudConnected: boolean;
  foregroundEpoch: number;
}>;
let status: Status = { state: supabase ? "CONNECTING" : "DISABLED" };
let listeners: ((value: Status) => void)[] = [];
let lease: RuntimeWriterLease | undefined;
let remoteRevision = 0;
let activeStartup: Promise<()=>void>|undefined;
// A lifecycle/auth restart may replace the per-exercise sync generation while
// its final checkpoint RPC is still settling. The next generation must not
// resolve/acquire against remote state until that publication is terminal.
let publicationBarrier: Promise<void> = Promise.resolve();
let exerciseSyncGeneration = 0;
let ensureLeaseRenewalForCurrentWriter: (() => boolean) | undefined;
let wakeCheckpointPublicationForCurrentWriter: (() => void) | undefined;
let manualRenewLeaseForValidation: (() => Promise<boolean>) | undefined;
let lastCheckpointPublicationAt: string | undefined;
let lastRecoveryOutcome: Readonly<{ state: string; code?: string; occurredAt: string }> | undefined;
let updateNativeHeartbeatTokenForCurrentWriter: ((accessToken: string) => void) | undefined;
let establishExerciseRuntimeOwnerForCurrentWriter: (() => boolean) | undefined;
let ensureSharedWorkflowHeadsForCurrentWriter: (() => Promise<boolean>) | undefined;
let drainPatientCommandsForCurrentWriter: (() => Promise<number>) | undefined;
let resumePendingCompletionForCurrentWriter: (() => void) | undefined;
type RenewalDiagnosticEvent = Readonly<{
  event: "LEASE_ACQUIRED" | "RENEWAL_SCHEDULER_STARTED" | "RENEWAL_ATTEMPT" | "RENEWAL_SUCCESS" | "RENEWAL_FAILURE" | "RENEWAL_SCHEDULER_STOPPED" | "AUTHORITY_TRANSITION";
  occurredAt: string;
  detail: string;
}>;
const renewalDiagnostics: RenewalDiagnosticEvent[] = [];

/** Validation-only, bounded and deliberately identifier-free. */
function recordRenewalDiagnostic(event: RenewalDiagnosticEvent["event"], detail: string): void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return;
  renewalDiagnostics.push(Object.freeze({ event, occurredAt: new Date().toISOString(), detail }));
  if (renewalDiagnostics.length > 24) renewalDiagnostics.splice(0, renewalDiagnostics.length - 24);
}

async function startupAwait<T>(operation: Promise<T>, timeoutMs = STARTUP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("AUTHORITY_STARTUP_TIMEOUT")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type RuntimeAuthStartup = Pick<
  NonNullable<typeof supabase>["auth"],
  "getSession" | "startAutoRefresh" | "stopAutoRefresh"
>;

type RuntimeWriterAcquisition = Pick<RuntimeCheckpointRepository, "acquireWriter"> &
  Pick<SupabaseRuntimeCheckpointRepository, "loadWriterLease">;

type RuntimeWriterRenewal = Pick<RuntimeCheckpointRepository, "renewWriter"> &
  Pick<SupabaseRuntimeCheckpointRepository, "loadWriterLease">;

type RuntimeWriterRenewalResult = Awaited<ReturnType<typeof renewRuntimeWriterTerminal>>;

export type RuntimeCheckpointRecoveryResult = Readonly<
  | { state: "RECOVERED"; checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>; lease: RuntimeWriterLease }
  | { state: "REJECTED"; code: string; revision?: number }
>;

type RuntimeCheckpointRecoveryRequest = Readonly<{
  intentId: string;
  exerciseId: string;
  writerInstanceId: string;
  repository: Pick<RuntimeCheckpointRepository, "loadLatest" | "loadLatestMetadata" | "releaseWriter">;
  acquire: (expectedRevision: number) => Promise<Awaited<ReturnType<typeof acquireRuntimeWriterTerminal>>>;
  validate?: (checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined) => checkpoint is RuntimeCheckpointEnvelope<SharedExerciseState>;
  loadCheckpoint?: () => Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined>;
  adopt: (checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, lease: RuntimeWriterLease) => Promise<void> | void;
}>;

/** One coordinator owns recovery-intent idempotency; repository CAS still owns writer authority. */
export class RuntimeCheckpointRecoveryCoordinator {
  private readonly intents = new Map<string, Promise<RuntimeCheckpointRecoveryResult>>();

  recover(request: RuntimeCheckpointRecoveryRequest): Promise<RuntimeCheckpointRecoveryResult> {
    const existing = this.intents.get(request.intentId);
    if (existing) return existing;
    const pending = this.execute(request);
    this.intents.set(request.intentId, pending);
    return pending;
  }

  private async execute(request: RuntimeCheckpointRecoveryRequest): Promise<RuntimeCheckpointRecoveryResult> {
    const validate = request.validate ?? isValidRuntimeCheckpoint;
    const inspected = request.loadCheckpoint
      ? await request.loadCheckpoint()
      : await request.repository.loadLatest(request.exerciseId, "runtime_checkpoints.recovery_payload");
    if (!inspected) return { state: "REJECTED", code: "CHECKPOINT_NOT_FOUND" };
    if (inspected.exerciseId !== request.exerciseId) return { state: "REJECTED", code: "REMOTE_SYNC_CONFLICT" };
    if (!validate(inspected)) return { state: "REJECTED", code: "CHECKPOINT_HASH_INVALID" };

    const acquired = await request.acquire(inspected.checkpointRevision);
    if (!("lease" in acquired)) {
      return { state: "REJECTED", code: acquired.code, revision: acquired.checkpointRevision };
    }
    if (acquired.lease.exerciseId !== request.exerciseId || acquired.lease.writerInstanceId !== request.writerInstanceId) {
      await request.repository.releaseWriter(acquired.lease);
      return { state: "REJECTED", code: "REMOTE_SYNC_CONFLICT" };
    }

    const latest = await loadCheckpointFreshness(request.repository, request.exerciseId, "recovery");
    if (!latest || latest.exerciseId !== request.exerciseId) {
      await request.repository.releaseWriter(acquired.lease);
      return { state: "REJECTED", code: latest ? "REMOTE_SYNC_CONFLICT" : "CHECKPOINT_NOT_FOUND" };
    }
    if (latest.checkpointRevision !== inspected.checkpointRevision || latest.payloadHash !== inspected.payloadHash) {
      await request.repository.releaseWriter(acquired.lease);
      return { state: "REJECTED", code: "CHECKPOINT_REVISION_CONFLICT", revision: latest.checkpointRevision };
    }

    try {
      await request.adopt(inspected, acquired.lease);
    } catch {
      await request.repository.releaseWriter(acquired.lease);
      return { state: "REJECTED", code: "CHECKPOINT_HASH_INVALID" };
    }
    return { state: "RECOVERED", checkpoint: inspected, lease: acquired.lease };
  }
}

const runtimeCheckpointRecoveryCoordinator = new RuntimeCheckpointRecoveryCoordinator();
let recoveryIntentSequence = 0;
let activeRecovery: Promise<Status> | undefined;

export function renewalFailureRevokesWriter(
  result: Exclude<RuntimeWriterRenewalResult, { lease: RuntimeWriterLease }>,
  currentLease: RuntimeWriterLease,
  nowMs = Date.now(),
): boolean {
  if (
    result.code === "STALE_WRITER" ||
    result.code === "WRITER_AUTHORITY_HELD" ||
    result.code === "WRITER_LEASE_EXPIRED"
  ) {
    return true;
  }
  return Date.parse(currentLease.expiresAt) <= nowMs;
}

type RuntimeWriterRenewalLoopOptions = Readonly<{
  getLease: () => RuntimeWriterLease | undefined;
  isWriter: () => boolean;
  renew: (currentLease: RuntimeWriterLease) => Promise<RuntimeWriterRenewalResult>;
  onRenewed: (currentLease: RuntimeWriterLease, refreshedLease: RuntimeWriterLease) => void;
  onTransientFailure: (currentLease: RuntimeWriterLease, code: string) => void;
  onRevoked: (currentLease: RuntimeWriterLease, code: string) => void;
  onAttempt?: () => void;
  onStopped?: (reason: "STOPPED" | "NO_WRITER") => void;
  intervalMs?: number;
  now?: () => number;
}>;

type RuntimeWriterRenewalLoop = Readonly<{
  isActive: () => boolean;
  wake: () => void;
  stop: (reason?: "GENERATION_CLEANUP" | "AUTHORITY_LOSS" | "EXPLICIT_STOP" | "TERMINAL_COMPLETION") => void;
}>;

export function startRuntimeWriterRenewalLoop(options: RuntimeWriterRenewalLoopOptions): RuntimeWriterRenewalLoop {
  const scheduler = nextRuntimeLeaseTraceLabel("scheduler");
  traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_CREATED", { scheduler, detail: { intervalMs: options.intervalMs ?? RENEW_MS } });
  let interval: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let stopped = false;
  const renewalIntervalMs = options.intervalMs ?? RENEW_MS;
  const heartbeatMs = Math.min(1_000, renewalIntervalMs);
  let renewalDueInMs = renewalIntervalMs;
  const runAttempt = () => {
    traceRuntimeLeaseLifecycle("RENEW_TIMER_CALLBACK_ENTER", { scheduler, detail: {} });
    const renewingLease = options.getLease();
    traceRuntimeLeaseLifecycle("RENEW_GUARD_EVALUATED", { scheduler, detail: { stopped, inFlight, writer: options.isWriter(), leasePresent: Boolean(renewingLease) } });
    if (stopped || inFlight) { traceRuntimeLeaseLifecycle("RENEW_SKIPPED", { scheduler, detail: { reason: stopped ? "SYNC_STOPPED" : "RENEWAL_IN_FLIGHT" } }); traceRuntimeLeaseLifecycle("RENEW_TIMER_CALLBACK_EXIT", { scheduler, detail: { outcome: "SKIPPED" } }); return; }
    if (!renewingLease || !options.isWriter()) {
      traceRuntimeLeaseLifecycle("RENEW_SKIPPED", { scheduler, detail: { reason: !renewingLease ? "LEASE_MISSING" : "NOT_WRITER" } });
      stopped = true;
      options.onStopped?.("NO_WRITER");
      traceRuntimeLeaseLifecycle("RENEW_TIMER_CALLBACK_EXIT", { scheduler, detail: { outcome: "SKIPPED" } }); return;
    }
    inFlight = true;
    renewalDueInMs = renewalIntervalMs;
    options.onAttempt?.();
    const renewalStartedAt = Date.now();
    traceRuntimeLeaseLifecycle("RENEW_RPC_START", { scheduler, detail: {} });
    void options.renew(renewingLease).then(result => {
      if (stopped || options.getLease()?.leaseId !== renewingLease.leaseId) return;
      if ("lease" in result) {
        traceRuntimeLeaseLifecycle("RENEW_RPC_RESULT", { scheduler, detail: { result: "SUCCESS", latencyMs: Date.now() - renewalStartedAt } });
        traceRuntimeLeaseLifecycle("RENEW_SUCCESS_DOWNSTREAM_BEGIN", { scheduler, detail: {} });
        options.onRenewed(renewingLease, result.lease);
        traceRuntimeLeaseLifecycle("RENEW_SUCCESS_DOWNSTREAM_END", { scheduler, detail: {} });
      } else if (renewalFailureRevokesWriter(result, renewingLease, options.now?.() ?? Date.now())) {
        traceRuntimeLeaseLifecycle("RENEW_RPC_RESULT", { scheduler, detail: { result: result.code, latencyMs: Date.now() - renewalStartedAt } });
        options.onRevoked(renewingLease, result.code);
      } else {
        traceRuntimeLeaseLifecycle("RENEW_RPC_RESULT", { scheduler, detail: { result: result.code, latencyMs: Date.now() - renewalStartedAt } });
        options.onTransientFailure(renewingLease, result.code);
      }
    }).catch(() => {
      traceRuntimeLeaseLifecycle("RENEW_RPC_ERROR", { scheduler, detail: { latencyMs: Date.now() - renewalStartedAt } });
      if (stopped || options.getLease()?.leaseId !== renewingLease.leaseId) return;
      const transient = {
        status: "AUTHORITY_UNAVAILABLE" as const,
        code: "WRITER_AUTHORITY_UNAVAILABLE" as const,
      };
      if (renewalFailureRevokesWriter(transient, renewingLease, options.now?.() ?? Date.now())) {
        options.onRevoked(renewingLease, transient.code);
      } else {
        options.onTransientFailure(renewingLease, transient.code);
      }
    }).finally(() => {
      inFlight = false;
      traceRuntimeLeaseLifecycle("RENEW_TIMER_CALLBACK_EXIT", { scheduler, detail: { outcome: "SETTLED" } });
      traceRuntimeLeaseLifecycle("RENEW_NOT_RESCHEDULED", { scheduler, detail: { reason: "PERSISTENT_INTERVAL" } });
    });
  };
  if (!options.getLease() || !options.isWriter()) {
    stopped = true;
    options.onStopped?.("NO_WRITER");
  } else {
    traceRuntimeLeaseLifecycle("RENEW_TIMER_SCHEDULED", { scheduler, detail: { delayMs: heartbeatMs } });
    // Use the same one-second native heartbeat as ClockRunner, but retain the
    // 20-second network renewal cadence. Some release Android builds defer a
    // long idle timer even while the foreground Runtime clock is executing.
    // The service-owned heartbeat makes the due renewal observable without
    // increasing RPC frequency; `inFlight` preserves the single-request rule.
    interval = setInterval(() => {
      const currentLease = options.getLease();
      if (currentLease && !inFlight && Date.parse(currentLease.expiresAt) <= Date.now()) {
        stopped = true;
        traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_STOP_REQUESTED", { scheduler, detail: { reason: "AUTHORITY_LOSS", timerPresent: true } });
        clearInterval(interval);
        interval = undefined;
        traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_STOPPED", { scheduler, detail: { reason: "AUTHORITY_LOSS" } });
        options.onRevoked(currentLease, "WRITER_LEASE_EXPIRED");
        return;
      }
      renewalDueInMs -= heartbeatMs;
      if (renewalDueInMs <= 0) runAttempt();
    }, heartbeatMs);
    traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_STARTED", { scheduler, detail: {} });
  }
  return {
    isActive: () => !stopped,
    wake: () => {
      if (stopped || inFlight) return;
      runAttempt();
    },
    stop: (reason = "EXPLICIT_STOP") => {
      traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_STOP_REQUESTED", { scheduler, detail: { reason, timerPresent: Boolean(interval) } });
      stopped = true;
      options.onStopped?.("STOPPED");
      if (interval) clearInterval(interval);
      interval = undefined;
      traceRuntimeLeaseLifecycle("LEASE_SCHEDULER_STOPPED", { scheduler, detail: { reason } });
    },
  };
}

export async function acquireRuntimeWriterTerminal(
  repository: RuntimeWriterAcquisition,
  exerciseId: string,
  writerInstanceId: string,
  expectedRevision: number,
  leaseSec: number,
) {
  try {
    const acquisition = await startupAwait(repository.acquireWriter(
      exerciseId,
      writerInstanceId,
      expectedRevision,
      leaseSec,
    ));
    return acquisition;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "AUTHORITY_STARTUP_TIMEOUT") throw error;
    // The RPC may have committed while its response was lost. Reconcile from
    // the authoritative lease row rather than issuing another write. Only the
    // exact same writer identity can be accepted as already owned.
    const activeLease = await startupAwait(repository.loadWriterLease(exerciseId));
    if (activeLease?.writerInstanceId === writerInstanceId) {
      return {
        status: "ALREADY_OWNED" as const,
        checkpointRevision: expectedRevision,
        lease: activeLease,
      };
    }
    if (activeLease) {
      return {
        status: "HELD_BY_OTHER_WRITER" as const,
        code: "WRITER_AUTHORITY_HELD" as const,
      };
    }
    throw error;
  }
}

export async function renewRuntimeWriterTerminal(
  repository: RuntimeWriterRenewal,
  currentLease: RuntimeWriterLease,
  leaseSec: number,
) {
  let renewal: Awaited<ReturnType<RuntimeCheckpointRepository["renewWriter"]>>;
  try {
    renewal = await startupAwait(repository.renewWriter(currentLease, leaseSec));
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "AUTHORITY_STARTUP_TIMEOUT") throw error;
    renewal = { status: "AUTHORITY_UNAVAILABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" };
  }
  if ("lease" in renewal || renewal.code !== "WRITER_AUTHORITY_UNAVAILABLE") return renewal;

  // A transport failure is not proof that writer authority was lost. Read the
  // canonical lease before demoting; the existing renewal loop can safely try
  // again on its next interval when the exact same lease remains active.
  try {
    const activeLease = await startupAwait(repository.loadWriterLease(currentLease.exerciseId));
    if (activeLease?.leaseId === currentLease.leaseId &&
        activeLease.writerInstanceId === currentLease.writerInstanceId) {
      return {
        status: "ALREADY_OWNED" as const,
        checkpointRevision: remoteRevision,
        lease: activeLease,
      };
    }
  } catch {
    // Reconciliation also unavailable: fail closed and let the caller demote.
  }
  return renewal;
}

export async function resolveRuntimeAuthSession(auth: RuntimeAuthStartup) {
  // On React Native a cold client can start the proactive refresh ticker while
  // getSession() is still restoring and refreshing the persisted session.
  // Serialize that one initialization boundary, then always restore normal
  // proactive refresh behaviour for the live application.
  await auth.stopAutoRefresh();
  try {
    return await startupAwait(auth.getSession());
  } finally {
    void auth.startAutoRefresh();
  }
}

function setStatus(value: Status): void {
  status=value;
  setRuntimeWriterAuthorityState(value.state === "WRITER" ? "WRITER" : value.state === "ACQUIRING" ? "ACQUIRING" : value.state === "READER" ? "READER" : value.state === "CONFLICT" ? "CONFLICT" : value.state === "OFFLINE" ? "OFFLINE" : "UNRESOLVED");
  recordRenewalDiagnostic("AUTHORITY_TRANSITION", value.state);
  listeners.forEach(listener=>listener(value));
}
export const getRuntimeCheckpointSyncStatus = (): Status => status;
export async function renewRuntimeLeaseNowForValidation(): Promise<boolean> {
  if (!isSharedWorkflowValidationHarnessEnabled()) {
    traceRuntimeLeaseLifecycle("MANUAL_RENEW_GUARD", { detail: { reason: "VALIDATION_DISABLED" } });
    return false;
  }
  if (!manualRenewLeaseForValidation) {
    traceRuntimeLeaseLifecycle("MANUAL_RENEW_GUARD", { detail: { reason: "GENERATION_STALE" } });
    return false;
  }
  return manualRenewLeaseForValidation();
}
export function getRuntimeCheckpointOperationalState() {
  return Object.freeze({
    ...status,
    writerInstanceId: lease?.writerInstanceId,
    leaseExpiresAt: lease?.expiresAt,
    lastCheckpointPublicationAt,
    lastRecoveryOutcome: lastRecoveryOutcome ? Object.freeze({ ...lastRecoveryOutcome }) : undefined,
    renewalDiagnostics: Object.freeze(renewalDiagnostics.map(item => Object.freeze({ ...item }))),
    leaseLifecycleTrace: getRuntimeLeaseLifecycleTrace(),
  });
}

/**
 * Validation-only evidence for a lifecycle intent.  It never changes local
 * authority and the remote lease read is deliberately metadata-only.  Native
 * heartbeat activity is not treated as authority: the server lease still has
 * to match the current Runtime writer.
 */
export async function traceRuntimeCompletionAuthority(stage: string): Promise<void> {
  const currentLease = lease;
  const localExpiryMs = currentLease ? Date.parse(currentLease.expiresAt) - Date.now() : undefined;
  traceRuntimeLeaseLifecycle("COMPLETE_AUTHORITY_SNAPSHOT", {
    detail: {
      stage,
      localAuthority: status.state,
      localLeasePresent: Boolean(currentLease),
      localLeaseFuture: localExpiryMs === undefined ? undefined : localExpiryMs > 0,
      runtimeWritesAllowed: runtimeWritesAllowed(),
    },
  });
  const native = await getNativeLeaseHeartbeatDiagnostic().catch(() => undefined);
  traceRuntimeLeaseLifecycle("COMPLETE_NATIVE_HEARTBEAT_SNAPSHOT", {
    detail: {
      stage,
      nativeState: native?.state ?? "UNAVAILABLE",
      nativeRecentSuccess: Boolean(native?.lastSuccessExpiresAt),
      nativeFailurePresent: Boolean(native?.lastFailure),
    },
  });
  if (!supabase || !currentLease) return;
  try {
    const remoteLease = await new SupabaseRuntimeCheckpointRepository(supabase).loadWriterLease(currentLease.exerciseId);
    traceRuntimeLeaseLifecycle("COMPLETE_SERVER_LEASE_SNAPSHOT", {
      detail: {
        stage,
        remoteLeaseActive: Boolean(remoteLease),
        remoteWriterMatchesLocal: Boolean(remoteLease && remoteLease.leaseId === currentLease.leaseId && remoteLease.writerInstanceId === currentLease.writerInstanceId),
        remoteLeaseFuture: remoteLease ? Date.parse(remoteLease.expiresAt) > Date.now() : false,
      },
    });
  } catch {
    traceRuntimeLeaseLifecycle("COMPLETE_SERVER_LEASE_SNAPSHOT", { detail: { stage, remoteLeaseRead: "FAILED" } });
  }
}
export function failRuntimeCheckpointStartup(error?: unknown): void {
  const code = error instanceof Error && error.message
    ? error.message
    : "WRITER_AUTHORITY_UNAVAILABLE";
  setStatus({state:"FAILED",code});
}
export function subscribeToRuntimeCheckpointSync(listener:(value:Status)=>void):()=>void { listeners.push(listener); return()=>{listeners=listeners.filter(item=>item!==listener);}; }

function isActiveExercise(): boolean {
  const lifecycle = getCanonicalExerciseSnapshot().lifecycleState;
  return lifecycle === "RUNNING" || lifecycle === "PAUSED";
}

export function checkpointForExercise(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  exerciseId: string,
): RuntimeCheckpointEnvelope<SharedExerciseState> | undefined {
  return checkpoint?.exerciseId === exerciseId ? checkpoint : undefined;
}

export function shouldRestartRuntimeCheckpointSync(previous: SyncIdentity, next: SyncIdentity): boolean {
  return previous.exerciseId !== next.exerciseId || previous.activeLifecycle !== next.activeLifecycle;
}

export function shouldRetryFreshRuntimeBootstrap(
  previous: RuntimeBootstrapRetrySignal,
  next: RuntimeBootstrapRetrySignal,
  currentStatus: Status,
): boolean {
  if (!next.activeLifecycle || currentStatus.state === "WRITER") return false;
  if (previous.exerciseId !== next.exerciseId || previous.activeLifecycle !== next.activeLifecycle) return false;
  // Applying an authoritative checkpoint refreshes the package binding. Once a
  // reader is healthy, that projection notification must not tear down the
  // reader generation that produced it and start an endless rehydration loop.
  // Package readiness may still retry a bootstrap that has not reached a
  // healthy reader state.
  const packageBindingBecameReady = previous.packageBindingVersion !== next.packageBindingVersion
    && (currentStatus.state !== "READER" || Boolean(currentStatus.code));
  return previous.scopedAuthorityReady !== next.scopedAuthorityReady
    || packageBindingBecameReady
    || previous.cloudConnected !== next.cloudConnected
    || previous.foregroundEpoch !== next.foregroundEpoch;
}
export function shouldResetRuntimeCheckpointSyncForPrincipal(previousUserId: string, nextUserId?: string): boolean {
  return previousUserId !== (nextUserId ?? "");
}

/**
 * Runtime writer ownership is exercise-controller authority. A scoped CM may
 * consume the canonical reader checkpoint and submit durable intents, but it
 * must never acquire a writer lease merely because its restored checkpoint is
 * equal to (or ahead of) the last remote payload.
 */
export function runtimeWriterAcquisitionAllowed(
  operator: OperatorSessionState,
  exerciseId: string,
): boolean {
  return hasActiveRole(operator, "EXCON", exerciseId);
}

export function runtimeWriterAppStateAction(nextState: string): "PRESERVE" | "RECONCILE" {
  return nextState === "active" ? "RECONCILE" : "PRESERVE";
}

export function publicationResultRevokesWriter(state: RuntimeCheckpointPublicationTerminal["state"]): boolean {
  return state === "STALE_WRITER" || state === "REVISION_CONFLICT";
}

export function isWriterCheckpointEcho(
  incoming: RuntimeCheckpointEnvelope<SharedExerciseState>,
  local: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  activeLease: RuntimeWriterLease | undefined,
  incomingWriterInstanceId?: string,
): boolean {
  return activeLease?.exerciseId === incoming.exerciseId &&
    local?.exerciseId === incoming.exerciseId &&
    (incomingWriterInstanceId === activeLease.writerInstanceId || local.payloadHash === incoming.payloadHash);
}

function checkpointLifecycle(checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): string {
  const session = checkpoint.payload.exerciseSession;
  return "lifecycleState" in session ? session.lifecycleState : session.state;
}

/** Flush evidence/lifecycle boundaries immediately; coalesce clock-only churn. */
export function isCheckpointPublicationBoundary(
  previous: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  next: RuntimeCheckpointEnvelope<SharedExerciseState>,
): boolean {
  if (!previous || previous.exerciseId !== next.exerciseId) return true;
  return checkpointLifecycle(previous) !== checkpointLifecycle(next) ||
    previous.payload.timelineEvents.length !== next.payload.timelineEvents.length ||
    (previous.payload.interventions?.length ?? 0) !== (next.payload.interventions?.length ?? 0) ||
    (previous.payload.medicationAdministrations?.length ?? 0) !== (next.payload.medicationAdministrations?.length ?? 0);
}

export function isIdenticalCheckpointPayload(
  previous: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  next: RuntimeCheckpointEnvelope<SharedExerciseState>,
): boolean {
  return previous?.exerciseId === next.exerciseId && previous.payloadHash === next.payloadHash;
}

export function checkpointPublicationPriority(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
): "ROUTINE" | "LIFECYCLE_CRITICAL" {
  return checkpointLifecycle(checkpoint) === "COMPLETED" ? "LIFECYCLE_CRITICAL" : "ROUTINE";
}

type PreparedWriterCandidate = Readonly<
  | { state: "READY"; checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>; rebased: boolean }
  | { state: "REJECTED"; code: CheckpointAuthorityDiagnosticCode }
>;

/** Rebuilds a lease-free candidate from durable authority before any writer
 * lease is requested. A failed or incomplete rebase cannot cross the writer
 * publication boundary. */
export async function prepareRuntimeWriterCandidateBeforeLease(
  resolution: RuntimeWriterCandidateCheckpointResolution,
  acceptRemote: (checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>) => Promise<void>,
  current: () => RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): Promise<PreparedWriterCandidate> {
  if (resolution.status === "NONE") return { state: "REJECTED", code: "CHECKPOINT_NOT_FOUND" };
  if (resolution.status === "CONFLICT") return { state: "REJECTED", code: resolution.code };
  const shouldRebase = resolution.status === "REMOTE" || resolution.status === "REMOTE_REBASE";
  if (shouldRebase) {
    try {
      await acceptRemote(resolution.checkpoint);
    } catch {
      return { state: "REJECTED", code: "CANONICAL_CHECKPOINT_CONFLICT" };
    }
    const accepted = current();
    if (!accepted || accepted.exerciseId !== resolution.checkpoint.exerciseId ||
        accepted.checkpointRevision !== resolution.checkpoint.checkpointRevision ||
        accepted.payloadHash !== resolution.checkpoint.payloadHash ||
        accepted.provenanceHash !== resolution.checkpoint.provenanceHash) {
      return { state: "REJECTED", code: "CANONICAL_CHECKPOINT_CONFLICT" };
    }
    return { state: "READY", checkpoint: accepted, rebased: true };
  }
  return { state: "READY", checkpoint: resolution.checkpoint, rebased: false };
}

export async function takeOverRuntimeWriter(): Promise<Status> {
  if (!supabase) return { state:"DISABLED" };
  const repository=new SupabaseRuntimeCheckpointRepository(supabase);
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId;
  if (!runtimeWriterAcquisitionAllowed(getOperatorSession(),exerciseId)) {
    return setAndReturn({state:"READER",code:"AUTHORIZATION_DENIED"});
  }
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
    stopClockRunner();
    return setAndReturn({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
  }
  const localCheckpoint=checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId);
  const remote=await loadRuntimeCheckpointWithCache(repository,exerciseId,localCheckpoint,"takeover");
  if (!remote) return setAndReturn({state:"CONFLICT",code:"CHECKPOINT_NOT_FOUND"});
  const resolved=resolveWriterCandidateCheckpoint(checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),remote);
  const prepared=await prepareRuntimeWriterCandidateBeforeLease(resolved,
    checkpoint=>acceptAuthoritativeRuntimeCheckpointForReaderAsync(checkpoint,yieldToEventLoop),
    ()=>checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId));
  if (prepared.state==="REJECTED") return setAndReturn({state:"CONFLICT",code:prepared.code});
  const writerId=await startupAwait(getRuntimeWriterInstanceId());
  const acquired=await acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remote.checkpointRevision,LEASE_SECONDS);
  if ("code" in acquired) return setAndReturn({state:"READER",code:acquired.code,revision:acquired.checkpointRevision});
  lease=acquired.lease;
  recordRenewalDiagnostic("LEASE_ACQUIRED", "takeover");
  setStatus({state:"ACQUIRING",revision:remote.checkpointRevision});
  if (!ensureLeaseRenewalForCurrentWriter?.()) {
    await repository.releaseWriter(acquired.lease); lease=undefined;
    return setAndReturn({state:"READER",code:"WRITER_RENEWAL_NOT_READY",revision:remote.checkpointRevision});
  }
  const confirmed=await confirmAcquiredRuntimeWriter(repository,acquired.lease);
  if (!confirmed) return setAndReturn({state:"READER",code:"WRITER_AUTHORITY_UNAVAILABLE",revision:remote.checkpointRevision});
  const latest=await loadCheckpointFreshness(repository,exerciseId,"takeover");
  if (!latest || latest.checkpointRevision!==remote.checkpointRevision || latest.payloadHash!==remote.payloadHash) {
    await repository.releaseWriter(confirmed); return setAndReturn({state:"CONFLICT",code:"CHECKPOINT_REVISION_CONFLICT"});
  }
  // The lease is authoritative before the checkpoint restore starts. Mark the
  // internal write boundary first so a concurrent shared-state echo cannot
  // clear the Runtime owners being installed by rehydration.
  lease=confirmed; remoteRevision=latest.checkpointRevision;
  setStatus({state:"WRITER",revision:remoteRevision});
  // `prepared.checkpoint` is the payload already validated and, when needed,
  // durably rebased above. The second
  // check reads only atomic metadata unless a rollout-safe fallback is needed.
  await acceptAuthoritativeRuntimeCheckpointAsync(prepared.checkpoint, true, yieldToEventLoop);
  if (!await ensureSharedWorkflowHeadsForCurrentWriter?.()) {
    await repository.releaseWriter(confirmed); lease=undefined; stopClockRunner();
    return setAndReturn({state:"READER",code:"WORKFLOW_HEAD_INITIALIZATION_FAILED",revision:remoteRevision});
  }
  if (!establishExerciseRuntimeOwnerForCurrentWriter?.()) {
    await repository.releaseWriter(confirmed); lease=undefined;
    return setAndReturn({state:"READER",code:"RUNTIME_OWNER_NOT_READY",revision:remoteRevision});
  }
  setRuntimeCommandAuthorityWriter(exerciseId);
  await drainPatientCommandsForCurrentWriter?.();
  resumePendingCompletionForCurrentWriter?.();
  wakeCheckpointPublicationForCurrentWriter?.();
  lastRecoveryOutcome=Object.freeze({state:"SUCCEEDED",code:"TAKEOVER",occurredAt:new Date().toISOString()});
  return status;
}

/** Explicit user recovery from a stale local revision; remote checkpoint remains authoritative. */
export function reacquireRuntimeFromRemoteCheckpoint(): Promise<Status> {
  if (status.state === "WRITER") return Promise.resolve(status);
  if (activeRecovery) return activeRecovery;
  recoveryIntentSequence += 1;
  const intentId = `RUNTIME-RECOVERY-${recoveryIntentSequence}`;
  const pending = reacquireRuntimeFromRemoteCheckpointForIntent(intentId);
  const tracked = pending.finally(() => { if (activeRecovery === tracked) activeRecovery = undefined; });
  activeRecovery = tracked;
  return activeRecovery;
}

async function reacquireRuntimeFromRemoteCheckpointForIntent(intentId: string): Promise<Status> {
  if (!supabase) return { state:"DISABLED" };
  const repository=new SupabaseRuntimeCheckpointRepository(supabase);
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId;
  if (!runtimeWriterAcquisitionAllowed(getOperatorSession(),exerciseId)) {
    lastRecoveryOutcome=Object.freeze({state:"DENIED",code:"AUTHORIZATION_DENIED",occurredAt:new Date().toISOString()});
    return setAndReturn({state:"READER",code:"AUTHORIZATION_DENIED"});
  }
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
    stopClockRunner(); return setAndReturn({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
  }
  const writerId=await startupAwait(getRuntimeWriterInstanceId());
  const recovered = await runtimeCheckpointRecoveryCoordinator.recover({ intentId, exerciseId, writerInstanceId:writerId, repository,
    loadCheckpoint:()=>loadRuntimeCheckpointWithCache(repository,exerciseId,checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),"recovery"),
    acquire: expectedRevision => acquireRuntimeWriterTerminal(repository,exerciseId,writerId,expectedRevision,LEASE_SECONDS),
    // Restore only after the acquired lease has entered the same renewal
    // lifecycle as a normal writer. This avoids installing writable owners
    // while authority is still merely provisional.
    adopt: () => {},
  });
  if (recovered.state === "REJECTED") {
    lastRecoveryOutcome=Object.freeze({state:"DENIED",code:recovered.code,occurredAt:new Date().toISOString()});
    return setAndReturn({
    state: recovered.code === "WRITER_AUTHORITY_HELD" ? "READER" : "CONFLICT",
    code: recovered.code, revision: recovered.revision,
    });
  }
  lease=recovered.lease;
  recordRenewalDiagnostic("LEASE_ACQUIRED", "recovery");
  setStatus({state:"ACQUIRING",revision:recovered.checkpoint.checkpointRevision});
  if (!ensureLeaseRenewalForCurrentWriter?.()) {
    await repository.releaseWriter(recovered.lease); lease=undefined;
    return setAndReturn({state:"READER",code:"WRITER_RENEWAL_NOT_READY",revision:recovered.checkpoint.checkpointRevision});
  }
  const confirmed=await confirmAcquiredRuntimeWriter(repository,recovered.lease);
  if (!confirmed) return setAndReturn({state:"READER",code:"WRITER_AUTHORITY_UNAVAILABLE",revision:recovered.checkpoint.checkpointRevision});
  lease=confirmed; remoteRevision=recovered.checkpoint.checkpointRevision;
  setStatus({state:"WRITER",revision:remoteRevision});
  await acceptAuthoritativeRuntimeCheckpointAsync(recovered.checkpoint,true,yieldToEventLoop);
  if (!await ensureSharedWorkflowHeadsForCurrentWriter?.()) {
    await repository.releaseWriter(confirmed); lease=undefined; stopClockRunner();
    return setAndReturn({state:"READER",code:"WORKFLOW_HEAD_INITIALIZATION_FAILED",revision:remoteRevision});
  }
  if (!establishExerciseRuntimeOwnerForCurrentWriter?.()) {
    await repository.releaseWriter(confirmed); lease=undefined;
    return setAndReturn({state:"READER",code:"RUNTIME_OWNER_NOT_READY",revision:remoteRevision});
  }
  setRuntimeCommandAuthorityWriter(exerciseId);
  await drainPatientCommandsForCurrentWriter?.();
  resumePendingCompletionForCurrentWriter?.();
  wakeCheckpointPublicationForCurrentWriter?.();
  lastRecoveryOutcome=Object.freeze({state:"SUCCEEDED",code:"CHECKPOINT_RECOVERY",occurredAt:new Date().toISOString()});
  return status;
}

function setAndReturn(value:Status):Status { setStatus(value); return value; }

/** A takeover is not stable authority until its just-acquired lease has made
 * one server-confirmed renewal. A late or stale takeover is released rather
 * than briefly exposing a writable client. */
async function confirmAcquiredRuntimeWriter(repository: RuntimeWriterRenewal & Pick<RuntimeCheckpointRepository,"releaseWriter">, acquired: RuntimeWriterLease): Promise<RuntimeWriterLease | undefined> {
  const confirmation=await renewRuntimeWriterTerminal(repository,acquired,LEASE_SECONDS);
  if ("lease" in confirmation && confirmation.lease.leaseId===acquired.leaseId && confirmation.lease.writerInstanceId===acquired.writerInstanceId) return confirmation.lease;
  await repository.releaseWriter(acquired);
  return undefined;
}

async function startRuntimeCheckpointSyncForExercise(exerciseId: string): Promise<()=>void> {
  if (!supabase) { setStatus({state:"DISABLED"}); return()=>{}; }
  const generation = ++exerciseSyncGeneration;
  const traceGeneration = `exercise-gen-${generation}`;
  traceRuntimeLeaseLifecycle("EXERCISE_SYNC_GENERATION_CREATED", { generation: traceGeneration, detail: { exerciseId } });
  let stopped=false;
  await publicationBarrier;
  const generationStopped = () => stopped || generation !== exerciseSyncGeneration;
  const runtimeOwnerGeneration = new RuntimeExerciseOwnerGeneration(exerciseId, () => !generationStopped());
  const establishRuntimeOwner = (): boolean => {
    if (generationStopped() || !lease || status.state !== "WRITER") return false;
    const established = runtimeOwnerGeneration.establish();
    traceRuntimeLeaseLifecycle(established ? "EXERCISE_RUNTIME_OWNER_REGISTERED" : "EXERCISE_RUNTIME_OWNER_NOT_READY", {
      generation: traceGeneration,
      detail: { exerciseId },
    });
    return established;
  };
  const ensureWorkflowHeads = async (): Promise<boolean> => {
    if (generationStopped() || !lease || status.state !== "WRITER") return false;
    const patientIds = getAllPatients().map(patient => patient.id);
    try {
      await startupAwait(ensureSharedWorkflowPatientHeads(exerciseId, patientIds));
    } catch (error) {
      traceRuntimeLeaseLifecycle("WORKFLOW_HEAD_INITIALIZATION_FAILED", {
        generation: traceGeneration,
        detail: { exerciseId, patientCount: patientIds.length,
          reason: error instanceof Error ? error.message : "UNKNOWN" },
      });
      return false;
    }
    const ready = !generationStopped() && Boolean(lease) && status.state === "WRITER";
    traceRuntimeLeaseLifecycle("WORKFLOW_HEAD_INITIALIZATION_COMPLETE", {
      generation: traceGeneration,
      detail: { exerciseId, patientCount: patientIds.length, ready },
    });
    return ready;
  };
  const releaseRuntimeOwner = (reason: string): void => {
    const wasReady = runtimeOwnerGeneration.isReady();
    runtimeOwnerGeneration.release();
    if (!wasReady) return;
    traceRuntimeLeaseLifecycle("EXERCISE_RUNTIME_OWNER_RELEASED", {
      generation: traceGeneration,
      detail: { exerciseId, reason },
    });
  };
  establishExerciseRuntimeOwnerForCurrentWriter = establishRuntimeOwner;
  ensureSharedWorkflowHeadsForCurrentWriter = ensureWorkflowHeads;
  let remoteLifecycleActive = isRemoteRuntimeLifecycleActive(exerciseId);
  if (remoteLifecycleActive === false && isActiveExercise()) {
    remoteLifecycleActive = await startupAwait(waitForRemoteRuntimeLifecycleActive(exerciseId));
  }
  if (remoteLifecycleActive === false) {
    stopClockRunner();
    setStatus({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
    return()=>{};
  }
  const client = supabase;
  const repository=new SupabaseRuntimeCheckpointRepository(client);
  const writerId=await getRuntimeWriterInstanceId();
  let local:RuntimeCheckpointEnvelope<SharedExerciseState>|undefined=checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId);
  beginRuntimeReaderConvergence(exerciseId);
  let authoritativeReaderRevision=0;
  let authoritativeReaderPayloadHash="";
  const authoritativeReaderCurrent=()=>{
    const current=checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId);
    return current?.checkpointRevision===authoritativeReaderRevision&&current.payloadHash===authoritativeReaderPayloadHash
      ? current : undefined;
  };
  const acceptReaderCheckpoint=async(checkpoint:RuntimeCheckpointEnvelope<SharedExerciseState>,source:"CACHE"|"REMOTE"|"DELTA")=>{
    await acceptAuthoritativeRuntimeCheckpointForReaderAsync(checkpoint,yieldToEventLoop);
    if(generationStopped())return;
    authoritativeReaderRevision=checkpoint.checkpointRevision;
    authoritativeReaderPayloadHash=checkpoint.payloadHash;
    acceptRuntimeReaderCheckpoint(checkpoint,source);
  };
  let remote:RuntimeCheckpointEnvelope<SharedExerciseState>|undefined;
  const endRemoteHydrationLoad = startRuntimeWorkTrace("STARTUP_REMOTE_HYDRATION_LOAD", {
    localCheckpointRevision: local?.checkpointRevision,
  });
  try { remote=await startupAwait(loadRuntimeCheckpointWithCache(repository,exerciseId,local,"startup")); }
  catch (error) { if (error instanceof Error && error.message === "AUTHORITY_STARTUP_TIMEOUT") throw error; setStatus({state:"OFFLINE"}); }
  endRemoteHydrationLoad({
    remoteCheckpointRevision: remote?.checkpointRevision,
    remotePayloadHash: remote?.payloadHash,
    persistedRuntimeCount: remote?.payload.persistedRuntimeStates?.length ?? 0,
  });
  try { if(!remote && isActiveExercise())local=ensureLocalRuntimeCheckpoint(); }
  catch (error) {
    if(error instanceof Error && error.message==="ACTIVE_RUNTIME_PERSISTENCE_MISSING"){
      setRuntimePersistenceFailure({code:"ACTIVE_RUNTIME_PERSISTENCE_MISSING",exerciseId});
      setStatus({state:"DISABLED"}); return()=>{};
    }
    throw error;
  }
  const endRemoteResolution = startRuntimeWorkTrace("STARTUP_REMOTE_CHECKPOINT_RESOLUTION", {
    localCheckpointRevision: local?.checkpointRevision,
    remoteCheckpointRevision: remote?.checkpointRevision,
  });
  let resolved=await resolveAuthoritativeCheckpointAsync(local,remote,yieldToEventLoop);
  endRemoteResolution({ status: resolved.status });
  if (resolved.status==="CONFLICT" && resolved.code==="CHECKPOINT_REVISION_DIVERGENCE" && remote &&
      runtimeWriterAcquisitionAllowed(getOperatorSession(),exerciseId)) {
    const writerCandidate=resolveWriterCandidateCheckpoint(local,remote,resolved);
    setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING",revision:remote.checkpointRevision});
    const prepared=await prepareRuntimeWriterCandidateBeforeLease(writerCandidate,
      checkpoint=>acceptReaderCheckpoint(checkpoint,"REMOTE"),
      ()=>checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId));
    if(prepared.state==="READY"){
      local=prepared.checkpoint;
      remoteRevision=prepared.checkpoint.checkpointRevision;
      resolved={status:"EQUIVALENT",checkpoint:prepared.checkpoint};
    } else resolved={status:"CONFLICT",code:prepared.code};
  }
  if (resolved.status==="CONFLICT") setStatus({state:"CONFLICT",code:resolved.code});
  else if (resolved.status==="REMOTE") {
    remoteRevision=resolved.checkpoint.checkpointRevision;
    setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING",revision:remoteRevision});
    await acceptReaderCheckpoint(resolved.checkpoint,local===resolved.checkpoint?"CACHE":"REMOTE");
    setStatus({state:"READER",revision:remoteRevision});
    stopClockRunner();
  }
  else if (resolved.status!=="NONE" && isActiveExercise()) {
    remoteRevision=remote?.checkpointRevision??0;
    if (!runtimeWriterAcquisitionAllowed(getOperatorSession(),exerciseId)) {
      // A normal CM is a durable-command reader/submitter, never an implicit
      // writer candidate. Prefer the server-confirmed checkpoint even when a
      // restored local cache is numerically newer. Realtime advances this
      // reader after the controller publishes canonical state.
      if(remote){
        setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING",revision:remote.checkpointRevision});
        remoteRevision=remote.checkpointRevision;
        await acceptReaderCheckpoint(remote,local===remote?"CACHE":"REMOTE");
        setStatus({state:"READER",revision:remoteRevision});
      } else {
        setRuntimeReaderConvergenceUnavailable(exerciseId,"AUTHORITATIVE_CHECKPOINT_PENDING");
        setStatus({state:"READER",code:"AUTHORITATIVE_CHECKPOINT_PENDING"});
      }
      stopClockRunner();
    } else {
      const acquired=await acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remoteRevision,LEASE_SECONDS);
      if ("lease" in acquired) {
        // A process recreation may restore the envelope before the in-memory
        // Runtime owner registrations exist. Rehydrate the resolved canonical
        // checkpoint atomically before publishing writer authority.
        // The acquired lease already grants authority; expose it to the internal
        // mutation boundary before restore so a concurrent cloud projection echo
        // cannot dispose the freshly registered Runtime owners.
        lease=acquired.lease;
        setRuntimeWriterAuthorityState("WRITER");
        setStatus({state:"WRITER",revision:remoteRevision});
        await acceptAuthoritativeRuntimeCheckpointAsync(resolved.checkpoint, true, yieldToEventLoop);
        if (!await ensureWorkflowHeads()) {
          await repository.releaseWriter(acquired.lease); lease=undefined; stopClockRunner();
          setRuntimeWriterAuthorityState("READER");
          setStatus({state:"READER",code:"WORKFLOW_HEAD_INITIALIZATION_FAILED",revision:remoteRevision});
        } else if (!establishRuntimeOwner()) {
          await repository.releaseWriter(acquired.lease); lease=undefined;
          setRuntimeWriterAuthorityState("READER");
          setStatus({state:"READER",code:"RUNTIME_OWNER_NOT_READY",revision:remoteRevision});
        } else setRuntimeCommandAuthorityWriter(exerciseId);
      }
      else {
        // A discovery projection can clear the locally restored Runtime while
        // writer acquisition is unresolved. Once another writer is confirmed,
        // rebuild the validated checkpoint explicitly as a read-only Runtime.
        // Reader authority is established before the cooperative rebuild so a
        // same-exercise cloud echo cannot dispose the in-flight reader state.
        setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING",revision:acquired.checkpointRevision});
        // Once another writer is confirmed, its validated durable payload owns
        // reader state even when a historical reader cache minted a numerically
        // higher local-only revision.
        if(remote){
          remoteRevision=remote.checkpointRevision;
          await acceptReaderCheckpoint(remote,local===remote?"CACHE":"REMOTE");
          setStatus({state:"READER",code:acquired.code,revision:remoteRevision});
        } else setRuntimeReaderConvergenceUnavailable(exerciseId,"AUTHORITATIVE_CHECKPOINT_PENDING");
        stopClockRunner();
      }
    }
  } else if(resolved.status==="NONE") setStatus({state:"DISABLED"});
  else setStatus({state:"READER",revision:remoteRevision});

  let publishInFlight=false;
  let publishQueued=false;
  let publicationDirty=false;
  let publicationIntentGeneration=0;
  let terminalIntentGeneration:number|undefined;
  let resolveTerminalPublication:(()=>void)|undefined;
  let activePublicationPriority:"ROUTINE"|"LIFECYCLE_CRITICAL"|undefined;
  let routinePublishTimer:ReturnType<typeof setTimeout>|undefined;
  let publicationRetryTimer:ReturnType<typeof setTimeout>|undefined;
  // Only a checkpoint loaded from the authoritative repository has already
  // been published.  On a fresh exercise `resolved.checkpoint` is the local
  // rev1 bootstrap envelope; treating it as the remote base suppresses the
  // first CAS publication and leaves a RUNNING exercise without durable
  // Runtime state.
  let lastPublishedCheckpoint=remote;
  let lastPublicationAt=Date.now();
  let pendingWriterEcho: Readonly<{
    payloadHash:string;
    checkpoint:RuntimeCheckpointEnvelope<SharedExerciseState>;
    resolve:(result:RuntimeCheckpointPublicationTerminal)=>void;
  }>|undefined;
  type CanonicalCommandCommitWaiter = Readonly<{
    command: AcceptedRuntimePatientCommand;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }>;
  const canonicalCommandCommitWaiters=new Map<string,CanonicalCommandCommitWaiter>();
  let requestCanonicalCommandPublication=()=>{};
  const settleCanonicalCommandCommitWaiters=(checkpoint:RuntimeCheckpointEnvelope<SharedExerciseState>)=>{
    for(const [commandId,waiter] of canonicalCommandCommitWaiters){
      if(!checkpointHasCanonicalEttMaterialization(checkpoint,waiter.command))continue;
      canonicalCommandCommitWaiters.delete(commandId);waiter.resolve();
    }
  };
  const rejectCanonicalCommandCommitWaiters=(code:string)=>{
    for(const waiter of canonicalCommandCommitWaiters.values())waiter.reject(new Error(code));
    canonicalCommandCommitWaiters.clear();
  };
  const commitCanonicalPatientCommand=async(command:AcceptedRuntimePatientCommand,
    materialization:Readonly<{status:"MATERIALIZED"|"REJECTED"}>):Promise<void>=>{
    if(command.commandType!=="ENDOTRACHEAL_INTUBATION"||materialization.status!=="MATERIALIZED")return;
    if(checkpointHasCanonicalEttMaterialization(lastPublishedCheckpoint,command))return;
    const existing=canonicalCommandCommitWaiters.get(command.commandId);
    if(existing)return existing.promise;
    let resolve!:()=>void;let reject!:(error:Error)=>void;
    const promise=new Promise<void>((onResolve,onReject)=>{resolve=onResolve;reject=onReject;});
    canonicalCommandCommitWaiters.set(command.commandId,Object.freeze({command,promise,resolve,reject}));
    // The durable status stays ACCEPTED until a remote acknowledgement proves
    // that both the deterministic ETT instance and its evidence are canonical.
    requestCanonicalCommandPublication();
    return promise;
  };
  const patientCommandGateway=getRuntimePatientCommandGateway();
  const patientCommandConsumer=patientCommandGateway
    ? new RuntimePatientCommandConsumer(patientCommandGateway,materializeRuntimePatientCommand,
      ()=>getCanonicalExerciseSnapshot().simulationTimeSec,commitCanonicalPatientCommand) : undefined;
  const completionGateway=getRuntimeCompletionGateway();
  let activeCompletion:RuntimeCompletionRequest|undefined;
  let completionProcessing:Promise<void>|undefined;
  let terminalAuthorityFinalizer:(()=>void)|undefined;

  const drainPatientCommands=async(throughSequence?:number):Promise<number>=>{
    if(!patientCommandConsumer||!lease||status.state!=="WRITER")return getRuntimePatientCommandCursor(exerciseId);
    let previous=-1;
    let cursor=getRuntimePatientCommandCursor(exerciseId);
    do {
      previous=cursor;
      cursor=await patientCommandConsumer.drain(exerciseId,lease,throughSequence);
    } while(throughSequence!==undefined&&cursor<throughSequence&&cursor>previous);
    if(throughSequence!==undefined&&cursor<throughSequence)throw new Error("RUNTIME_COMMAND_FENCE_NOT_DRAINED");
    return cursor;
  };
  const drainPendingPatientCommands=()=>drainPatientCommands();
  drainPatientCommandsForCurrentWriter=drainPendingPatientCommands;
  const stopDeferredPatientCommandDrain=subscribeToSync(()=>{
    if(!generationStopped()&&lease&&status.state==="WRITER"&&patientCommandConsumer?.hasDeferredCommands()){
      void drainPatientCommands().catch(()=>setStatus({state:"WRITER",code:"RUNTIME_COMMAND_MATERIALIZATION_FAILED",revision:remoteRevision}));
    }
  });

  const processCompletionRequest=(request:RuntimeCompletionRequest|undefined):void=>{
    if(!request||request.exerciseId!==exerciseId)return;
    activeCompletion=request;
    setRuntimeCompletionPhase(exerciseId,request.status==="COMPLETED"?"COMPLETED":"PENDING");
    if(request.status!=="PENDING"||!lease||status.state!=="WRITER"||!runtimeOwnerGeneration.isReady()||completionProcessing)return;
    const task=(async()=>{
      try {
        await drainPatientCommands(request.fenceCommandSequence);
        if(generationStopped()||!lease||status.state!=="WRITER")return;
        setRuntimeCompletionPhase(exerciseId,"FINALIZING");
        const current=getCanonicalExerciseSnapshot();
        if(current.lifecycleState!=="COMPLETED"){
          const applied=handleExerciseControlCommand({commandId:request.commandId,exerciseId,
            commandType:"COMPLETE_EXERCISE",issuedBy:"Exercise Controller",
            issuedAtWallClock:new Date().toISOString(),expectedVersion:current.version});
          if(!applied.ok){setRuntimeCompletionPhase(exerciseId,"FAILED",applied.errorCode);return;}
        } else registerLifecycleCriticalIntent(true);
      } catch(error) {
        setRuntimeCompletionPhase(exerciseId,"FAILED",error instanceof Error?error.message:"COMPLETION_MATERIALIZATION_FAILED");
      }
    })().finally(()=>{if(completionProcessing===task)completionProcessing=undefined;});
    completionProcessing=task;
  };
  const resumePendingCompletion=()=>{
    if(generationStopped()||!runtimeOwnerGeneration.isReady())return;
    if(activeCompletion)processCompletionRequest(activeCompletion);
    else if(completionGateway)void completionGateway.load(exerciseId).then(processCompletionRequest)
      .catch(()=>setRuntimeCompletionPhase(exerciseId,"FAILED","COMPLETION_REQUEST_LOAD_FAILED"));
  };
  resumePendingCompletionForCurrentWriter=resumePendingCompletion;
  const registerLifecycleCriticalIntent=(fromCommandIntent=false)=>{
    const snapshot=getCanonicalExerciseSnapshot();
    if(snapshot.exerciseId!==exerciseId||(!fromCommandIntent&&snapshot.lifecycleState!=="COMPLETED")||terminalIntentGeneration!==undefined)return;
    terminalIntentGeneration=++publicationIntentGeneration;
    publishQueued=true;
    const terminalDrain=new Promise<void>(resolve=>{resolveTerminalPublication=resolve;});
    publicationBarrier=terminalDrain;
    traceRuntimeLeaseLifecycle("CHECKPOINT_LIFECYCLE_PRIORITY_REGISTERED",{generation:traceGeneration,detail:{intentGeneration:terminalIntentGeneration,activePublicationPriority:activePublicationPriority??"NONE"}});
  };
  const cancelLifecycleCriticalIntent=()=>{
    if(terminalIntentGeneration===undefined)return;
    terminalIntentGeneration=undefined;
    resolveTerminalPublication?.();resolveTerminalPublication=undefined;
  };
  const schedulePublicationRetry=()=>{
    if(generationStopped()||publicationRetryTimer||!publicationDirty||!lease||status.state!=="WRITER")return;
    publicationRetryTimer=setTimeout(()=>{publicationRetryTimer=undefined;requestPublish();},ROUTINE_CHECKPOINT_PUBLICATION_MS);
  };
  const runPublish=async()=>{
    publishInFlight=true;
    try {
      do {
        publishQueued=false;
        const checkpoint=getLocalRuntimeCheckpoint(); if(!checkpoint||!lease||status.state!=="WRITER"||checkpoint.checkpointRevision<=remoteRevision||isIdenticalCheckpointPayload(lastPublishedCheckpoint,checkpoint)) return;
        publicationDirty=true;
        const priority=checkpointPublicationPriority(checkpoint);
        const intentGeneration=priority==="LIFECYCLE_CRITICAL"?(terminalIntentGeneration??++publicationIntentGeneration):publicationIntentGeneration;
        if(priority==="LIFECYCLE_CRITICAL")terminalIntentGeneration=intentGeneration;
        activePublicationPriority=priority;
        let rpcSubmitted=false;
        let publicationSuperseded=false;
        const endPublish = startRuntimeWorkTrace("CHECKPOINT_REMOTE_PUBLICATION", {
          checkpointRevision: checkpoint.checkpointRevision,
          priority,
          intentGeneration,
        });
        const echoAcknowledgement=new Promise<{source:"ECHO";result:Awaited<ReturnType<typeof publishRuntimeCheckpointTerminal>>}>(resolve=>{
          pendingWriterEcho={payloadHash:checkpoint.payloadHash,checkpoint,resolve:result=>resolve({source:"ECHO",result})};
        });
        const completionForCheckpoint=priority==="LIFECYCLE_CRITICAL"&&activeCompletion?.status==="PENDING"
          ? activeCompletion : undefined;
        const publicationRepository:Pick<RuntimeCheckpointRepository,"loadLatest"|"loadLatestMetadata"|"publish">=completionForCheckpoint&&repository.finalizeCompletion ? {
          loadLatest:repository.loadLatest.bind(repository),
          loadLatestMetadata:repository.loadLatestMetadata.bind(repository),
          publish:(publicationLease:RuntimeWriterLease,expectedRevision:number,terminalCheckpoint:RuntimeCheckpointEnvelope<SharedExerciseState>)=>
            repository.finalizeCompletion!(completionForCheckpoint.commandId,publicationLease,expectedRevision,terminalCheckpoint),
        } : repository;
        const activePublicationRepository=isSharedWorkflowValidationHarnessEnabled() ? {
          loadLatest:publicationRepository.loadLatest.bind(publicationRepository),
          loadLatestMetadata:publicationRepository.loadLatestMetadata.bind(publicationRepository),
          publish:(...args:Parameters<RuntimeCheckpointRepository["publish"]>)=>
            interceptRuntimeCheckpointPublicationResponseForValidation(publicationRepository.publish(...args),checkpoint.exerciseId),
        } : publicationRepository;
        const publication=publishRuntimeCheckpointTerminal(activePublicationRepository,lease,remoteRevision,checkpoint,undefined,lastPublishedCheckpoint,{
          priority,
          yieldControl:yieldToEventLoop,
          shouldContinue:()=>!generationStopped()&&!publicationSuperseded&&(priority==="LIFECYCLE_CRITICAL"||terminalIntentGeneration===undefined)&&intentGeneration===publicationIntentGeneration,
          onRpcSubmitted:()=>{rpcSubmitted=true;traceRuntimeLeaseLifecycle("CHECKPOINT_PUBLICATION_RPC_SUBMITTED",{generation:traceGeneration,detail:{priority,intentGeneration}});},
        }).then(result=>({source:"RPC" as const,result}));
        const settled=await Promise.race([publication,echoAcknowledgement]);
        if(settled.source==="ECHO")publicationSuperseded=true;
        const result=settled.result;
        if(generationStopped()) { endPublish({ outcome: "GENERATION_STOPPED" }); return; }
        if(pendingWriterEcho?.payloadHash===checkpoint.payloadHash)pendingWriterEcho=undefined;
        if(result.state==="GENERATION_STOPPED") {
          publicationDirty=true;
          endPublish({outcome:"GENERATION_STOPPED",priority,intentGeneration,rpcSubmitted});
          traceRuntimeLeaseLifecycle("CHECKPOINT_PUBLICATION_PREEMPTED",{generation:traceGeneration,detail:{priority,intentGeneration,rpcSubmitted}});
          continue;
        }
        if(result.state==="PUBLISHED") {
          const currentLocal=getLocalRuntimeCheckpoint();
          // A newer prepared checkpoint may exist by the time this ACK arrives.
          // Never replace that dirty canonical state with an older acknowledged
          // envelope; advance only the remote publication cursor.
          const shouldAccept=!currentLocal||currentLocal.checkpointRevision<=result.checkpoint.checkpointRevision||isIdenticalCheckpointPayload(currentLocal,result.checkpoint);
          const endLocalAcknowledgement=startRuntimeWorkTrace("REMOTE_PUB_LOCAL_ACKNOWLEDGEMENT",{checkpointRevision:result.checkpoint.checkpointRevision});
          if(shouldAccept)localRuntimeCheckpointStore.acceptPublishedAcknowledgement(checkpoint,result.checkpoint);
          endLocalAcknowledgement({checkpointRevision:result.checkpoint.checkpointRevision,accepted:shouldAccept});
          lastPublishedCheckpoint=result.checkpoint;lastPublicationAt=Date.now();lastCheckpointPublicationAt=new Date(lastPublicationAt).toISOString();remoteRevision=result.checkpoint.checkpointRevision;
          settleCanonicalCommandCommitWaiters(result.checkpoint);
          publicationDirty=Boolean(currentLocal&&!isIdenticalCheckpointPayload(result.checkpoint,currentLocal));
          let terminalFinalized=false;
          if(priority==="LIFECYCLE_CRITICAL"){
            if(completionForCheckpoint){activeCompletion=Object.freeze({...completionForCheckpoint,status:"COMPLETED",
              terminalCheckpointRevision:result.checkpoint.checkpointRevision,terminalPayloadHash:result.checkpoint.payloadHash});
              setRuntimeCompletionPhase(exerciseId,"COMPLETED");terminalFinalized=true;terminalAuthorityFinalizer?.();}
            terminalIntentGeneration=undefined;
            resolveTerminalPublication?.();resolveTerminalPublication=undefined;
          }
          if(!terminalFinalized)setStatus({state:"WRITER",revision:remoteRevision});
          endPublish({ outcome: "PUBLISHED",priority,intentGeneration,rpcSubmitted });
        }
        else if(result.state==="RECONCILED_FORWARD") {
          // The server advanced on this same writer lineage while an earlier
          // response was lost.  Move only the CAS cursor: without the matching
          // payload object a delta base would be unsafe, so the retry publishes
          // the newest local checkpoint as a canonical full snapshot.
          remoteRevision=result.checkpointRevision;
          lastPublishedCheckpoint=undefined;
          const currentLocal=getLocalRuntimeCheckpoint();
          publicationDirty=Boolean(currentLocal&&currentLocal.checkpointRevision>remoteRevision);
          publishQueued=publicationDirty;
          setStatus({state:"WRITER",code:result.code,revision:remoteRevision});
          endPublish({outcome:"RECONCILED_FORWARD",priority,intentGeneration,rpcSubmitted,
            reconciledRevision:result.checkpointRevision});
          continue;
        }
        else if(publicationResultRevokesWriter(result.state)) { endPublish({ outcome: result.state });rejectCanonicalCommandCommitWaiters("CANONICAL_COMMAND_WRITER_AUTHORITY_LOST"); releaseRuntimeOwner("PUBLICATION_AUTHORITY_LOST"); lease=undefined; stopClockRunner(); setStatus({state:"CONFLICT",code:result.code}); return; }
        else { endPublish({ outcome: result.state }); publicationDirty=true;setStatus({state:"WRITER",code:result.code,revision:remoteRevision});schedulePublicationRetry(); }
      } while(publishQueued);
    } catch {
      publicationDirty=true;schedulePublicationRetry();
    } finally { activePublicationPriority=undefined;publishInFlight=false;if(publicationDirty&&terminalIntentGeneration===undefined)schedulePublicationRetry(); }
  };
  const publishNow=()=>{
    if(generationStopped())return;
    if(routinePublishTimer){clearTimeout(routinePublishTimer);routinePublishTimer=undefined;}
    if(publishInFlight){publishQueued=true;return;}
    const task=runPublish();
    publicationBarrier=task.then(()=>undefined,()=>undefined);
  };
  const requestPublish=()=>{
    if(generationStopped())return;
    const checkpoint=getLocalRuntimeCheckpoint();
    if(!checkpoint||isIdenticalCheckpointPayload(lastPublishedCheckpoint,checkpoint))return;
    publicationDirty=true;
    if(checkpointPublicationPriority(checkpoint)==="LIFECYCLE_CRITICAL"){
      registerLifecycleCriticalIntent();
      publishQueued=true;
      if(publishInFlight)return;
      publishNow();return;
    }
    if(isCheckpointPublicationBoundary(lastPublishedCheckpoint,checkpoint)){publishNow();return;}
    if(routinePublishTimer)return;
    const remaining=Math.max(0,ROUTINE_CHECKPOINT_PUBLICATION_MS-(Date.now()-lastPublicationAt));
    routinePublishTimer=setTimeout(()=>{routinePublishTimer=undefined;publishNow();},remaining);
  };
  requestCanonicalCommandPublication=()=>{notifySync("local");requestPublish();};
  wakeCheckpointPublicationForCurrentWriter=requestPublish;
  // Register lifecycle priority as soon as the canonical lifecycle changes;
  // terminal checkpoint preparation may still be cooperatively in progress.
  const stopLifecyclePriority=subscribeToSync(()=>registerLifecycleCriticalIntent(false));
  const stopCompletionIntent=installRuntimeCompletionIntentListener(active=>active?registerLifecycleCriticalIntent(true):cancelLifecycleCriticalIntent());
  // Prepared checkpoints are the single canonical publication trigger.
  // Listening to SyncService here duplicated every trigger before capture.
  const stopPrepared=subscribeToLocalRuntimeCheckpointPrepared(requestPublish);
  let renewalLoop: RuntimeWriterRenewalLoop | undefined;
  let nativeHeartbeat: RuntimeNativeLeaseHeartbeatController | undefined;
  let nativeHeartbeatStarting = false;
  const nativeHeartbeatEnabled = Platform.OS === "android" && isNativeLeaseHeartbeatAvailable();
  const stopNativeHeartbeat = (reason: string) => {
    const controller = nativeHeartbeat;
    nativeHeartbeat = undefined;
    nativeHeartbeatStarting = false;
    if (updateNativeHeartbeatTokenForCurrentWriter) updateNativeHeartbeatTokenForCurrentWriter = undefined;
    if (controller) void controller.stop(reason);
  };
  const startNativeHeartbeat = (): boolean => {
    if (!nativeHeartbeatEnabled || nativeHeartbeat || nativeHeartbeatStarting || !lease) return Boolean(nativeHeartbeat);
    const currentLease = lease;
    nativeHeartbeatStarting = true;
    const controller = new RuntimeNativeLeaseHeartbeatController(diagnostic => {
      if (generationStopped() || lease?.leaseId !== currentLease.leaseId) return;
      if (diagnostic.lastSuccessExpiresAt) {
        lease = Object.freeze({ ...currentLease, expiresAt: diagnostic.lastSuccessExpiresAt });
      }
      // A stopped native scheduler can no longer preserve authority. Transient
      // network failures remain ACTIVE and retry natively; STOPPED therefore
      // always means that authority must fail closed, including lease expiry
      // reached while the network was unavailable.
      if (diagnostic.state === "STOPPED" && diagnostic.lastFailure) {
        traceRuntimeLeaseLifecycle("AUTHORITY_LOSS", { generation: traceGeneration, detail: { priorAuthority: status.state, nextAuthority: "READER", code: diagnostic.lastFailure } });
        releaseRuntimeOwner("NATIVE_AUTHORITY_LOST");
        lease = undefined;
        stopClockRunner();
        setStatus({ state: "READER", code: diagnostic.lastFailure });
      }
    });
    void client.auth.getSession().then(async ({ data, error }) => {
      const accessToken = data.session?.access_token;
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (error || !accessToken || !supabaseUrl || !supabasePublishableKey || generationStopped() || lease?.leaseId !== currentLease.leaseId) {
        traceRuntimeLeaseLifecycle("NATIVE_RENEW_RPC_FAILURE", { generation: traceGeneration, detail: { result: "SESSION_UNAVAILABLE" } });
        return;
      }
      const session: NativeLeaseHeartbeatSession = { accessToken, supabaseUrl, supabasePublishableKey };
      await controller.start(currentLease, LEASE_SECONDS, session);
      if (generationStopped() || lease?.leaseId !== currentLease.leaseId) { await controller.stop("STALE_START"); return; }
      nativeHeartbeat = controller;
      updateNativeHeartbeatTokenForCurrentWriter = token => { void controller.updateToken({ ...session, accessToken: token }); };
    }).catch(() => {
      traceRuntimeLeaseLifecycle("NATIVE_RENEW_RPC_FAILURE", { generation: traceGeneration, detail: { result: "NATIVE_START_FAILED" } });
    }).finally(() => { nativeHeartbeatStarting = false; });
    return true;
  };
  const ensureRenewal=()=>{
    if (renewalLoop && !renewalLoop.isActive()) renewalLoop=undefined;
    if(generationStopped() || !lease || (status.state!=="WRITER" && status.state!=="ACQUIRING"))return Boolean(renewalLoop?.isActive() || nativeHeartbeat);
    if (nativeHeartbeatEnabled) { startNativeHeartbeat(); return true; }
    if(renewalLoop)return renewalLoop.isActive();
    renewalLoop=startRuntimeWriterRenewalLoop({
      getLease:()=>lease,
      isWriter:()=>!generationStopped()&&(status.state==="WRITER"||status.state==="ACQUIRING"),
      renew:currentLease=>renewRuntimeWriterTerminal(repository,currentLease,LEASE_SECONDS),
      onRenewed:(currentLease,refreshedLease)=>{if(lease?.leaseId===currentLease.leaseId){lease=refreshedLease;recordRenewalDiagnostic("RENEWAL_SUCCESS", "current-generation");}},
      onTransientFailure:(currentLease,code)=>{
        if(lease?.leaseId===currentLease.leaseId){recordRenewalDiagnostic("RENEWAL_FAILURE", code);setStatus({state:"WRITER",code,revision:remoteRevision});}
      },
      onRevoked:(currentLease,code)=>{
        if(lease?.leaseId!==currentLease.leaseId)return;
        recordRenewalDiagnostic("RENEWAL_FAILURE", code);
        traceRuntimeLeaseLifecycle("AUTHORITY_LOSS", { generation: traceGeneration, detail: { priorAuthority: status.state, nextAuthority: "READER", code } });
        renewalLoop?.stop("AUTHORITY_LOSS");renewalLoop=undefined;stopNativeHeartbeat("AUTHORITY_LOSS");
        releaseRuntimeOwner("RENEWAL_AUTHORITY_LOST");lease=undefined;stopClockRunner();setStatus({state:"READER",code});
      },
      onAttempt:()=>recordRenewalDiagnostic("RENEWAL_ATTEMPT", "current-generation"),
      onStopped:reason=>recordRenewalDiagnostic("RENEWAL_SCHEDULER_STOPPED", reason),
    });
    recordRenewalDiagnostic("RENEWAL_SCHEDULER_STARTED", "current-generation");
    return renewalLoop.isActive();
  };
  ensureLeaseRenewalForCurrentWriter=ensureRenewal;
  terminalAuthorityFinalizer=()=>{
    renewalLoop?.stop("TERMINAL_COMPLETION");renewalLoop=undefined;
    stopNativeHeartbeat("TERMINAL_COMPLETION");
    releaseRuntimeOwner("TERMINAL_COMPLETION");lease=undefined;stopClockRunner();setRuntimeWriterAuthorityState("READER");
    setStatus({state:"READER",code:"EXERCISE_COMPLETED",revision:remoteRevision});
  };
  let manualRenewInFlight=false;
  const manualRenew=async()=>{
    const guardReason = generationStopped() ? "GENERATION_STALE" : !lease ? "LEASE_MISSING" : status.state!=="WRITER" ? "NOT_WRITER" : manualRenewInFlight ? "RENEWAL_IN_FLIGHT" : "VALID_WRITER";
    traceRuntimeLeaseLifecycle("MANUAL_RENEW_GUARD", { generation: traceGeneration, detail: { reason: guardReason } });
    if (guardReason!=="VALID_WRITER") return false;
    manualRenewInFlight=true;
    traceRuntimeLeaseLifecycle("MANUAL_RENEW_INVOKED", { generation: traceGeneration, detail: {} });
    const currentLease=lease;
    if (!currentLease) { manualRenewInFlight=false; return false; }
    try {
      const result=await renewRuntimeWriterTerminal(repository,currentLease,LEASE_SECONDS);
      if ("lease" in result && lease?.leaseId===currentLease.leaseId && !generationStopped()) { lease=result.lease; traceRuntimeLeaseLifecycle("MANUAL_RENEW_RESULT", { generation: traceGeneration, detail: { result:"SUCCESS" } }); return true; }
      traceRuntimeLeaseLifecycle("MANUAL_RENEW_RESULT", { generation: traceGeneration, detail: { result:"DENIED" } }); return false;
    } catch {
      traceRuntimeLeaseLifecycle("MANUAL_RENEW_RESULT", { generation: traceGeneration, detail: { result:"FAILED" } });
      return false;
    } finally { manualRenewInFlight=false; }
  };
  manualRenewLeaseForValidation=manualRenew;
  ensureRenewal();
  let realtimeSubscribed=false;
  const metadataCoordinator=new RuntimeCheckpointMetadataCoordinator({exerciseId,current:()=>lease?getLocalRuntimeCheckpoint():authoritativeReaderCurrent(),
    loadLatest:metadata=>loadRuntimeCheckpointWithCache(repository,exerciseId,checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),"realtime",metadata),
    ignored:reason=>recordSupabaseTraffic({operation:"REALTIME_METADATA_IGNORED",endpoint:`runtime_checkpoint_notifications.${reason.toLowerCase()}`}),
    coalesced:()=>recordSupabaseTraffic({operation:"REALTIME_FETCH_COALESCED",endpoint:"runtime_checkpoint_notifications"}),
    accept:async incoming=>{
      if(generationStopped())return;
      const decision=resolveSubscribedCheckpoint(lease?getLocalRuntimeCheckpoint():authoritativeReaderCurrent(),incoming,Boolean(lease));
      if(decision.status==="CONFLICT") { releaseRuntimeOwner("CHECKPOINT_CONFLICT");stopClockRunner(); setStatus({state:"CONFLICT",code:decision.code}); }
      else if(decision.status==="REMOTE"){
        if(lease){releaseRuntimeOwner("REMOTE_SYNC_CONFLICT");lease=undefined;stopClockRunner();setStatus({state:"CONFLICT",code:"REMOTE_SYNC_CONFLICT",revision:decision.checkpoint.checkpointRevision});}
        else {setStatus({state:"READER",code:"READER_CHECKPOINT_SYNCHRONIZING",revision:decision.checkpoint.checkpointRevision});
          await acceptReaderCheckpoint(decision.checkpoint,"REMOTE");stopClockRunner();remoteRevision=decision.checkpoint.checkpointRevision;setStatus({state:"READER",revision:remoteRevision});}
      }
    },
  });
  const handleMetadata=(value:unknown)=>{
    recordSupabaseTraffic({operation:"REALTIME_METADATA",endpoint:"runtime_checkpoint_notifications",data:value});
    if(generationStopped())return;
    const metadata=parseRuntimeCheckpointMetadata(value);
    if(metadata&&pendingWriterEcho?.payloadHash===metadata.payloadHash&&metadata.writerInstanceId===writerId){
      const pending=pendingWriterEcho;pendingWriterEcho=undefined;
      pending.resolve({state:"PUBLISHED",checkpoint:Object.freeze({...pending.checkpoint,checkpointRevision:metadata.checkpointRevision}),reconciled:true});
      return;
    }
    if(metadata&&lease&&status.state==="WRITER"&&metadata.writerInstanceId===writerId){
      if(metadata.checkpointRevision>remoteRevision){remoteRevision=metadata.checkpointRevision;setStatus({state:"WRITER",revision:remoteRevision});}
      recordSupabaseTraffic({operation:"REALTIME_METADATA_IGNORED",endpoint:"runtime_checkpoint_notifications.writer_echo"});
      return;
    }
    if(metadata&&!lease){
      advertiseRuntimeReaderCheckpoint(metadata);
      const current=checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId);
      if(current?.checkpointRevision===metadata.checkpointRevision&&current.payloadHash===metadata.payloadHash){
        authoritativeReaderRevision=current.checkpointRevision;
        authoritativeReaderPayloadHash=current.payloadHash;
        acceptRuntimeReaderCheckpoint(current,"CACHE");
      }
    }
    void metadataCoordinator.notify(metadata).catch(()=>{
      setRuntimeReaderConvergenceUnavailable(exerciseId,"AUTHORITY_UNAVAILABLE");
      setStatus({state:"OFFLINE",code:"AUTHORITY_UNAVAILABLE"});
    });
  };
  // The native heartbeat owns Android background lease continuity. AppState is
  // therefore a reconciliation signal, not an authority-transfer command.
  // A genuine remote writer change is still rejected by handleMetadata/CAS.
  const appStateSubscription=AppState.addEventListener("change",nextState=>{
    if(generationStopped())return;
    traceRuntimeLeaseLifecycle("APP_STATE_CHANGED", { generation: traceGeneration, detail: { nextState } });
    if(runtimeWriterAppStateAction(nextState)==="RECONCILE") {
      traceRuntimeLeaseLifecycle("APP_FOREGROUND_RECONCILIATION", { generation: traceGeneration, detail: {} });
      renewalLoop?.wake();
      void repository.loadLatestMetadata(exerciseId,"runtime_checkpoint_notifications.app_foreground_metadata").then(handleMetadata).catch(()=>setStatus({state:"OFFLINE",code:"AUTHORITY_UNAVAILABLE"}));
    }
  });
  const channel:RealtimeChannel=client.channel(`runtime-checkpoint-${exerciseId}`).on("postgres_changes",{event:"*",schema:"public",table:"runtime_checkpoint_notifications",filter:`exercise_id=eq.${exerciseId}`},payload=>{
    handleMetadata(payload.new);
  }).on("postgres_changes",{event:"*",schema:"public",table:"runtime_patient_command_notifications",filter:`exercise_id=eq.${exerciseId}`},()=>{
    if(!generationStopped()&&lease&&status.state==="WRITER")void drainPatientCommands().catch(()=>setStatus({state:"WRITER",code:"RUNTIME_COMMAND_MATERIALIZATION_FAILED",revision:remoteRevision}));
  }).on("postgres_changes",{event:"*",schema:"public",table:"runtime_completion_requests",filter:`exercise_id=eq.${exerciseId}`},()=>{
    if(!generationStopped()&&completionGateway)void completionGateway.load(exerciseId).then(processCompletionRequest)
      .catch(()=>setRuntimeCompletionPhase(exerciseId,"FAILED","COMPLETION_REQUEST_LOAD_FAILED"));
  }).subscribe(channelStatus=>{
    // Android may suspend timers while backgrounded or disconnected. A
    // successful realtime resubscription is the canonical connectivity signal:
    // reconcile the current lease immediately instead of waiting on a dormant
    // interval handle.
    if(channelStatus==="SUBSCRIBED"){
      recordSupabaseTraffic({operation:"REALTIME_SUBSCRIBE",endpoint:"runtime_checkpoint_notifications",reconnect:realtimeSubscribed});
      void repository.loadLatestMetadata(exerciseId,realtimeSubscribed?"runtime_checkpoint_notifications.reconnect_metadata":"runtime_checkpoint_notifications.subscription_metadata").then(handleMetadata).catch(()=>setStatus({state:"OFFLINE",code:"AUTHORITY_UNAVAILABLE"}));
      realtimeSubscribed=true;
    }
    if(channelStatus==="SUBSCRIBED"&&!generationStopped()){
      renewalLoop?.wake();requestPublish();
      if(lease&&status.state==="WRITER")void drainPatientCommands().catch(()=>setStatus({state:"WRITER",code:"RUNTIME_COMMAND_MATERIALIZATION_FAILED",revision:remoteRevision}));
      if(completionGateway)void completionGateway.load(exerciseId).then(processCompletionRequest)
        .catch(()=>setRuntimeCompletionPhase(exerciseId,"FAILED","COMPLETION_REQUEST_LOAD_FAILED"));
    }
  });
  let signOutReleaseInFlight:Promise<void>|undefined;
  const prepareWriterSignOut=():Promise<void>=>{
    if(signOutReleaseInFlight)return signOutReleaseInFlight;
    const currentLease=lease;
    if(generationStopped()||!currentLease)return Promise.resolve();
    const task=(async()=>{
      traceRuntimeLeaseLifecycle("OPERATOR_SIGN_OUT_RELEASE_STARTED",{generation:traceGeneration,detail:{exerciseId}});
      // Fail closed immediately: no new local command may enter while an
      // already-prepared canonical publication is allowed to settle.
      setRuntimeWriterAuthorityState("READER");
      beginRuntimeReaderConvergence(exerciseId);
      releaseRuntimeOwner("OPERATOR_SIGN_OUT");
      rejectCanonicalCommandCommitWaiters("CANONICAL_COMMAND_OPERATOR_SIGN_OUT");
      if(publicationDirty||publishInFlight){publishNow();await publicationBarrier;
        if(publicationDirty)throw new Error("WRITER_SIGNOUT_PUBLICATION_UNSETTLED");}
      renewalLoop?.stop("EXPLICIT_STOP");renewalLoop=undefined;
      stopNativeHeartbeat("EXPLICIT_STOP");
      await repository.releaseWriter(currentLease);
      if(lease?.leaseId===currentLease.leaseId)lease=undefined;
      stopClockRunner();
      setStatus({state:"READER",code:"OPERATOR_SIGNED_OUT",revision:remoteRevision});
      traceRuntimeLeaseLifecycle("OPERATOR_SIGN_OUT_RELEASED",{generation:traceGeneration,detail:{exerciseId}});
    })().catch(error=>{
      // Keep the authenticated session and the lease identity available for a
      // bounded retry, but never restore local write authority.
      setStatus({state:"FAILED",code:"WRITER_SIGNOUT_RELEASE_FAILED",revision:remoteRevision});
      traceRuntimeLeaseLifecycle("OPERATOR_SIGN_OUT_RELEASE_FAILED",{generation:traceGeneration,detail:{exerciseId}});
      throw error;
    }).finally(()=>{if(signOutReleaseInFlight===task)signOutReleaseInFlight=undefined;});
    signOutReleaseInFlight=task;
    return task;
  };
  const stopSignOutPreparation=registerOperatorSignOutPreparation(prepareWriterSignOut);
  return()=>{traceRuntimeLeaseLifecycle("EXERCISE_SYNC_GENERATION_STOPPED", { generation: traceGeneration, detail: { exerciseId, reason:"GENERATION_CLEANUP", authority:status.state } });rejectCanonicalCommandCommitWaiters("CANONICAL_COMMAND_GENERATION_STOPPED");releaseRuntimeOwner("GENERATION_CLEANUP");stopped=true;stopSignOutPreparation();appStateSubscription.remove();if(routinePublishTimer)clearTimeout(routinePublishTimer);if(publicationRetryTimer)clearTimeout(publicationRetryTimer);stopPrepared();stopLifecyclePriority();stopCompletionIntent();stopDeferredPatientCommandDrain();resolveTerminalPublication?.();resolveTerminalPublication=undefined;renewalLoop?.stop("GENERATION_CLEANUP");stopNativeHeartbeat("GENERATION_CLEANUP");terminalAuthorityFinalizer=undefined;if(manualRenewLeaseForValidation===manualRenew)manualRenewLeaseForValidation=undefined;if(ensureLeaseRenewalForCurrentWriter===ensureRenewal)ensureLeaseRenewalForCurrentWriter=undefined;if(wakeCheckpointPublicationForCurrentWriter===requestPublish)wakeCheckpointPublicationForCurrentWriter=undefined;if(establishExerciseRuntimeOwnerForCurrentWriter===establishRuntimeOwner)establishExerciseRuntimeOwnerForCurrentWriter=undefined;if(ensureSharedWorkflowHeadsForCurrentWriter===ensureWorkflowHeads)ensureSharedWorkflowHeadsForCurrentWriter=undefined;if(drainPatientCommandsForCurrentWriter===drainPendingPatientCommands)drainPatientCommandsForCurrentWriter=undefined;if(resumePendingCompletionForCurrentWriter===resumePendingCompletion)resumePendingCompletionForCurrentWriter=undefined;void client.removeChannel(channel);if(generation===exerciseSyncGeneration&&lease)void repository.releaseWriter(lease);if(generation===exerciseSyncGeneration){lease=undefined;resetRuntimeReaderConvergence(exerciseId);}};
}

async function startRuntimeCheckpointSyncOnce(): Promise<()=>void> {
  if (!supabase) { setStatus({state:"DISABLED"}); return()=>{}; }
  setStatus({state:"CONNECTING"});
  const { data: initialAuth, error: authError } = await resolveRuntimeAuthSession(supabase.auth);
  if (authError || !initialAuth.session?.user) { setStatus({state:"OFFLINE",code:"WRITER_AUTHORITY_UNAVAILABLE"}); return()=>{}; }
  let stopped=false;
  let principalId=initialAuth.session.user.id;
  let stopActive=()=>{};
  let switchChain=Promise.resolve();
  let activeExerciseId=getCanonicalExerciseSnapshot().exerciseId;
  let activeLifecycle=isActiveExercise();
  let foregroundEpoch=0;
  const bootstrapSignal=():RuntimeBootstrapRetrySignal=>{
    const operator=getOperatorSession();
    return Object.freeze({
      exerciseId:activeExerciseId,
      activeLifecycle,
      scopedAuthorityReady:hasActiveRole(operator,"CM",activeExerciseId)||hasActiveRole(operator,"EXCON",activeExerciseId),
      packageBindingVersion:getExercisePackageBindingVersion(),
      cloudConnected:["synced","saving"].includes(getCloudSyncStatus().state),
      foregroundEpoch,
    });
  };
  let lastBootstrapSignal=bootstrapSignal();
  const queueBootstrapRetry=()=>{
    const next=bootstrapSignal();
    const retry=shouldRetryFreshRuntimeBootstrap(lastBootstrapSignal,next,status);
    lastBootstrapSignal=next;
    if(!retry)return;
    switchChain=switchChain.then(async()=>{
      if(stopped||!isActiveExercise()||status.state==="WRITER")return;
      stopActive();
      stopActive=await startRuntimeCheckpointSyncForExercise(activeExerciseId);
    }).catch(()=>setStatus({state:"FAILED",code:"WRITER_AUTHORITY_UNAVAILABLE"}));
  };
  const { data: authSubscription }=supabase.auth.onAuthStateChange((_event,session)=>{
    if (session?.access_token) updateNativeHeartbeatTokenForCurrentWriter?.(session.access_token);
    const nextPrincipal=session?.user.id;
    if(!shouldResetRuntimeCheckpointSyncForPrincipal(principalId,nextPrincipal))return;
    principalId=nextPrincipal??"";
    switchChain=switchChain.then(async()=>{
      stopActive();
      if(stopped)return;
      if(!nextPrincipal){setStatus({state:"OFFLINE",code:"WRITER_AUTHORITY_UNAVAILABLE"});stopActive=()=>{};return;}
      activeExerciseId=getCanonicalExerciseSnapshot().exerciseId;
      activeLifecycle=isActiveExercise();
      stopActive=await startRuntimeCheckpointSyncForExercise(activeExerciseId);
    }).catch(()=>setStatus({state:"FAILED",code:"WRITER_AUTHORITY_UNAVAILABLE"}));
  });
  try { stopActive=await startRuntimeCheckpointSyncForExercise(activeExerciseId); }
  catch (error) { setStatus({state:"FAILED",code:error instanceof Error ? error.message : "WRITER_AUTHORITY_UNAVAILABLE"}); }
  const stopSwitch=subscribeToSync(()=>{
    const nextExerciseId=getCanonicalExerciseSnapshot().exerciseId;
    const nextActiveLifecycle=isActiveExercise();
    if(!shouldRestartRuntimeCheckpointSync(
      {exerciseId:activeExerciseId,activeLifecycle},
      {exerciseId:nextExerciseId,activeLifecycle:nextActiveLifecycle},
    ))return;
    const terminalTransition=activeLifecycle&&!nextActiveLifecycle;
    activeExerciseId=nextExerciseId;
    activeLifecycle=nextActiveLifecycle;
    switchChain=switchChain.then(async()=>{
      if(terminalTransition)await publicationBarrier;
      stopActive();
      const nextStop=await startRuntimeCheckpointSyncForExercise(activeExerciseId);
      if(stopped)nextStop();else stopActive=nextStop;
    }).catch(()=>setStatus({state:"FAILED",code:"WRITER_AUTHORITY_UNAVAILABLE"}));
  });
  const stopOperator=subscribeOperatorSession(queueBootstrapRetry);
  const stopPackage=subscribeToExercisePackageBindings(queueBootstrapRetry);
  const stopCloud=subscribeToCloudSyncStatus(()=>queueBootstrapRetry());
  const appStateSubscription=AppState.addEventListener("change",nextState=>{
    if(nextState!=="active")return;
    foregroundEpoch+=1;
    queueBootstrapRetry();
  });
  // Close the narrow window where readiness changed while the initial
  // per-exercise startup was awaiting network/auth work.
  queueBootstrapRetry();
  return()=>{stopped=true;stopSwitch();stopOperator();stopPackage();stopCloud();appStateSubscription.remove();authSubscription.subscription.unsubscribe();stopActive();};
}

export function startRuntimeCheckpointSync(): Promise<()=>void> {
  if(activeStartup)return activeStartup;
  activeStartup=startRuntimeCheckpointSyncOnce().then(stop=>()=>{stop();activeStartup=undefined;},error=>{activeStartup=undefined;throw error;});
  return activeStartup;
}
