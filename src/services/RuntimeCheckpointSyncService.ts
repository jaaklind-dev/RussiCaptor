import type { RealtimeChannel } from "@supabase/supabase-js";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import {
  acceptAuthoritativeRuntimeCheckpoint,
  ensureLocalRuntimeCheckpoint,
  getLocalRuntimeCheckpoint,
  subscribeToLocalRuntimeCheckpointPrepared,
} from "@/services/StatePersistenceService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { supabase } from "@/services/SupabaseService";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { subscribeToSync } from "@/services/SyncService";
import { isValidRuntimeCheckpoint, localRuntimeCheckpointStore, resolveAgainstValidatedLocalCheckpoint, resolveAuthoritativeCheckpoint, resolveSubscribedCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import {
  SupabaseRuntimeCheckpointRepository,
  loadCheckpointFreshness,
  type RuntimeCheckpointRepository,
} from "@/services/runtime/persistence/RuntimeCheckpointRepository";
import { getRuntimeWriterInstanceId } from "@/services/runtime/persistence/RuntimeWriterIdentityService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { publishRuntimeCheckpointTerminal, type RuntimeCheckpointPublicationTerminal } from "@/services/runtime/persistence/RuntimeCheckpointPublicationService";
import { isRemoteRuntimeLifecycleActive, waitForRemoteRuntimeLifecycleActive } from "@/services/CloudSyncService";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { parseRuntimeCheckpointMetadata, RuntimeCheckpointMetadataCoordinator } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";

const LEASE_SECONDS = 60;
const RENEW_MS = 20_000;
export const ROUTINE_CHECKPOINT_PUBLICATION_MS = 5_000;
const STARTUP_TIMEOUT_MS = 8_000;
type Status = Readonly<{ state: "DISABLED"|"CONNECTING"|"WRITER"|"READER"|"OFFLINE"|"CONFLICT"|"FAILED"; code?: string; revision?: number }>;
type SyncIdentity = Readonly<{ exerciseId: string; activeLifecycle: boolean }>;
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
let ensureLeaseRenewalForCurrentWriter: (() => void) | undefined;
let wakeCheckpointPublicationForCurrentWriter: (() => void) | undefined;

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
    const inspected = await request.repository.loadLatest(request.exerciseId, "runtime_checkpoints.recovery_payload");
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
  intervalMs?: number;
  now?: () => number;
}>;

type RuntimeWriterRenewalLoop = Readonly<{
  isActive: () => boolean;
  wake: () => void;
  stop: () => void;
}>;

export function startRuntimeWriterRenewalLoop(options: RuntimeWriterRenewalLoopOptions): RuntimeWriterRenewalLoop {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let stopped = false;
  const runAttempt = () => {
    const renewingLease = options.getLease();
    if (stopped || inFlight) return;
    if (!renewingLease || !options.isWriter()) {
      stopped = true;
      return;
    }
    inFlight = true;
    void options.renew(renewingLease).then(result => {
      if (stopped || options.getLease()?.leaseId !== renewingLease.leaseId) return;
      if ("lease" in result) {
        options.onRenewed(renewingLease, result.lease);
      } else if (renewalFailureRevokesWriter(result, renewingLease, options.now?.() ?? Date.now())) {
        options.onRevoked(renewingLease, result.code);
      } else {
        options.onTransientFailure(renewingLease, result.code);
      }
    }).catch(() => {
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
      schedule();
    });
  };
  const schedule = () => {
    if (stopped || timer || inFlight) return;
    if (!options.getLease() || !options.isWriter()) {
      stopped = true;
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      runAttempt();
    }, options.intervalMs ?? RENEW_MS);
  };
  schedule();
  return {
    isActive: () => !stopped,
    wake: () => {
      if (stopped || inFlight) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      runAttempt();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
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
  setRuntimeWriterAuthorityState(value.state === "WRITER" ? "WRITER" : value.state === "READER" ? "READER" : value.state === "CONFLICT" ? "CONFLICT" : value.state === "OFFLINE" ? "OFFLINE" : "UNRESOLVED");
  listeners.forEach(listener=>listener(value));
}
export const getRuntimeCheckpointSyncStatus = (): Status => status;
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
export function shouldResetRuntimeCheckpointSyncForPrincipal(previousUserId: string, nextUserId?: string): boolean {
  return previousUserId !== (nextUserId ?? "");
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

export async function takeOverRuntimeWriter(): Promise<Status> {
  if (!supabase) return { state:"DISABLED" };
  const repository=new SupabaseRuntimeCheckpointRepository(supabase);
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId;
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
    stopClockRunner();
    return setAndReturn({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
  }
  const remote=await repository.loadLatest(exerciseId,"runtime_checkpoints.takeover_payload");
  if (!remote) return setAndReturn({state:"CONFLICT",code:"CHECKPOINT_NOT_FOUND"});
  const resolved=resolveAgainstValidatedLocalCheckpoint(checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),remote);
  if (resolved.status==="CONFLICT" || resolved.status==="NONE") return setAndReturn({state:"CONFLICT",code:resolved.status==="CONFLICT"?resolved.code:"CHECKPOINT_NOT_FOUND"});
  const writerId=await startupAwait(getRuntimeWriterInstanceId());
  const acquired=await acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remote.checkpointRevision,LEASE_SECONDS);
  if ("code" in acquired) return setAndReturn({state:"READER",code:acquired.code,revision:acquired.checkpointRevision});
  const latest=await loadCheckpointFreshness(repository,exerciseId,"takeover");
  if (!latest || latest.checkpointRevision!==remote.checkpointRevision || latest.payloadHash!==remote.payloadHash) {
    await repository.releaseWriter(acquired.lease); return setAndReturn({state:"CONFLICT",code:"CHECKPOINT_REVISION_CONFLICT"});
  }
  // The lease is authoritative before the checkpoint restore starts. Mark the
  // internal write boundary first so a concurrent shared-state echo cannot
  // clear the Runtime owners being installed by rehydration.
  lease=acquired.lease; remoteRevision=latest.checkpointRevision;
  setRuntimeWriterAuthorityState("WRITER");
  setStatus({state:"WRITER",revision:remoteRevision});
  ensureLeaseRenewalForCurrentWriter?.();
  // `resolved.checkpoint` is the payload already validated above. The second
  // check reads only atomic metadata unless a rollout-safe fallback is needed.
  acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, true);
  wakeCheckpointPublicationForCurrentWriter?.();
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
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
    stopClockRunner(); return setAndReturn({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
  }
  const writerId=await startupAwait(getRuntimeWriterInstanceId());
  const recovered = await runtimeCheckpointRecoveryCoordinator.recover({ intentId, exerciseId, writerInstanceId:writerId, repository,
    acquire: expectedRevision => acquireRuntimeWriterTerminal(repository,exerciseId,writerId,expectedRevision,LEASE_SECONDS),
    adopt: checkpoint => {
      setRuntimeWriterAuthorityState("WRITER");
      try { acceptAuthoritativeRuntimeCheckpoint(checkpoint,true); }
      catch (error) { setRuntimeWriterAuthorityState("UNRESOLVED"); throw error; }
    },
  });
  if (recovered.state === "REJECTED") return setAndReturn({
    state: recovered.code === "WRITER_AUTHORITY_HELD" ? "READER" : "CONFLICT",
    code: recovered.code, revision: recovered.revision,
  });
  lease=recovered.lease; remoteRevision=recovered.checkpoint.checkpointRevision;
  setStatus({state:"WRITER",revision:remoteRevision});
  ensureLeaseRenewalForCurrentWriter?.();
  wakeCheckpointPublicationForCurrentWriter?.();
  return status;
}

function setAndReturn(value:Status):Status { setStatus(value); return value; }

async function startRuntimeCheckpointSyncForExercise(exerciseId: string): Promise<()=>void> {
  if (!supabase) { setStatus({state:"DISABLED"}); return()=>{}; }
  const generation = ++exerciseSyncGeneration;
  await publicationBarrier;
  const generationStopped = () => stopped || generation !== exerciseSyncGeneration;
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
  let stopped=false;
  let remote:RuntimeCheckpointEnvelope<SharedExerciseState>|undefined;
  try { remote=await startupAwait(repository.loadLatest(exerciseId)); }
  catch (error) { if (error instanceof Error && error.message === "AUTHORITY_STARTUP_TIMEOUT") throw error; setStatus({state:"OFFLINE"}); }
  let local:RuntimeCheckpointEnvelope<SharedExerciseState>|undefined;
  try { local=checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId); if(!remote && isActiveExercise())local=ensureLocalRuntimeCheckpoint(); }
  catch (error) {
    if(error instanceof Error && error.message==="ACTIVE_RUNTIME_PERSISTENCE_MISSING"){
      setRuntimePersistenceFailure({code:"ACTIVE_RUNTIME_PERSISTENCE_MISSING",exerciseId});
      setStatus({state:"DISABLED"}); return()=>{};
    }
    throw error;
  }
  const resolved=resolveAuthoritativeCheckpoint(local,remote);
  if (resolved.status==="CONFLICT") setStatus({state:"CONFLICT",code:resolved.code});
  else if (resolved.status==="REMOTE") { acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, false); stopClockRunner(); remoteRevision=resolved.checkpoint.checkpointRevision; setStatus({state:"READER",revision:remoteRevision}); }
  else if (resolved.status!=="NONE" && isActiveExercise()) {
    remoteRevision=remote?.checkpointRevision??0;
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
      acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, true);
    }
    else { stopClockRunner(); setStatus({state:"READER",code:acquired.code,revision:acquired.checkpointRevision}); }
  } else if(resolved.status==="NONE") setStatus({state:"DISABLED"});
  else setStatus({state:"READER",revision:remoteRevision});

  let publishInFlight=false;
  let publishQueued=false;
  let publicationDirty=false;
  let routinePublishTimer:ReturnType<typeof setTimeout>|undefined;
  let publicationRetryTimer:ReturnType<typeof setTimeout>|undefined;
  let lastPublishedCheckpoint=remote ?? (resolved.status!=="NONE"&&resolved.status!=="CONFLICT" ? resolved.checkpoint : undefined);
  let lastPublicationAt=Date.now();
  let pendingWriterEcho: Readonly<{
    payloadHash:string;
    checkpoint:RuntimeCheckpointEnvelope<SharedExerciseState>;
    resolve:(result:RuntimeCheckpointPublicationTerminal)=>void;
  }>|undefined;
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
        const echoAcknowledgement=new Promise<Awaited<ReturnType<typeof publishRuntimeCheckpointTerminal>>>(resolve=>{
          pendingWriterEcho={payloadHash:checkpoint.payloadHash,checkpoint,resolve};
        });
        const result=await Promise.race([publishRuntimeCheckpointTerminal(repository,lease,remoteRevision,checkpoint),echoAcknowledgement]);
        if(generationStopped())return;
        if(pendingWriterEcho?.payloadHash===checkpoint.payloadHash)pendingWriterEcho=undefined;
        if(result.state==="PUBLISHED") {
          const currentLocal=getLocalRuntimeCheckpoint();
          // A newer prepared checkpoint may exist by the time this ACK arrives.
          // Never replace that dirty canonical state with an older acknowledged
          // envelope; advance only the remote publication cursor.
          if(!currentLocal||currentLocal.checkpointRevision<=result.checkpoint.checkpointRevision||isIdenticalCheckpointPayload(currentLocal,result.checkpoint))localRuntimeCheckpointStore.accept(result.checkpoint);
          lastPublishedCheckpoint=result.checkpoint;lastPublicationAt=Date.now();remoteRevision=result.checkpoint.checkpointRevision;
          publicationDirty=Boolean(currentLocal&&!isIdenticalCheckpointPayload(result.checkpoint,currentLocal));
          setStatus({state:"WRITER",revision:remoteRevision});
        }
        else if(publicationResultRevokesWriter(result.state)) { lease=undefined; stopClockRunner(); setStatus({state:"CONFLICT",code:result.code}); return; }
        else { publicationDirty=true;setStatus({state:"WRITER",code:result.code,revision:remoteRevision});schedulePublicationRetry(); }
      } while(publishQueued);
    } catch {
      publicationDirty=true;schedulePublicationRetry();
    } finally { publishInFlight=false;if(publicationDirty)schedulePublicationRetry(); }
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
    if(isCheckpointPublicationBoundary(lastPublishedCheckpoint,checkpoint)){publishNow();return;}
    if(routinePublishTimer)return;
    const remaining=Math.max(0,ROUTINE_CHECKPOINT_PUBLICATION_MS-(Date.now()-lastPublicationAt));
    routinePublishTimer=setTimeout(()=>{routinePublishTimer=undefined;publishNow();},remaining);
  };
  wakeCheckpointPublicationForCurrentWriter=requestPublish;
  // Prepared checkpoints are the single canonical publication trigger.
  // Listening to SyncService here duplicated every trigger before capture.
  const stopPrepared=subscribeToLocalRuntimeCheckpointPrepared(requestPublish);
  let renewalLoop: RuntimeWriterRenewalLoop | undefined;
  const ensureRenewal=()=>{
    if (renewalLoop && !renewalLoop.isActive()) renewalLoop=undefined;
    if(generationStopped() || renewalLoop || !lease || status.state!=="WRITER")return;
    renewalLoop=startRuntimeWriterRenewalLoop({
      getLease:()=>lease,
      isWriter:()=>!generationStopped()&&status.state==="WRITER",
      renew:currentLease=>renewRuntimeWriterTerminal(repository,currentLease,LEASE_SECONDS),
      onRenewed:(currentLease,refreshedLease)=>{if(lease?.leaseId===currentLease.leaseId)lease=refreshedLease;},
      onTransientFailure:(currentLease,code)=>{
        if(lease?.leaseId===currentLease.leaseId)setStatus({state:"WRITER",code,revision:remoteRevision});
      },
      onRevoked:(currentLease,code)=>{
        if(lease?.leaseId!==currentLease.leaseId)return;
        renewalLoop?.stop();renewalLoop=undefined;
        lease=undefined;stopClockRunner();setStatus({state:"READER",code});
      },
    });
  };
  ensureLeaseRenewalForCurrentWriter=ensureRenewal;
  ensureRenewal();
  let realtimeSubscribed=false;
  const metadataCoordinator=new RuntimeCheckpointMetadataCoordinator({exerciseId,current:getLocalRuntimeCheckpoint,
    loadLatest:()=>repository.loadLatest(exerciseId,"runtime_checkpoints.conditional_payload"),
    ignored:reason=>recordSupabaseTraffic({operation:"REALTIME_METADATA_IGNORED",endpoint:`runtime_checkpoint_notifications.${reason.toLowerCase()}`}),
    coalesced:()=>recordSupabaseTraffic({operation:"REALTIME_FETCH_COALESCED",endpoint:"runtime_checkpoint_notifications"}),
    accept:incoming=>{
      if(generationStopped())return;
      const decision=resolveSubscribedCheckpoint(getLocalRuntimeCheckpoint(),incoming,Boolean(lease));
      if(decision.status==="CONFLICT") { stopClockRunner(); setStatus({state:"CONFLICT",code:decision.code}); }
      else if(decision.status==="REMOTE"){
        if(lease){lease=undefined;stopClockRunner();setStatus({state:"CONFLICT",code:"REMOTE_SYNC_CONFLICT",revision:decision.checkpoint.checkpointRevision});}
        else {acceptAuthoritativeRuntimeCheckpoint(decision.checkpoint,false);stopClockRunner();remoteRevision=decision.checkpoint.checkpointRevision;setStatus({state:"READER",revision:remoteRevision});}
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
    if(metadata&&lease&&metadata.writerInstanceId===writerId){
      if(metadata.checkpointRevision>remoteRevision){remoteRevision=metadata.checkpointRevision;setStatus({state:"WRITER",revision:remoteRevision});}
      recordSupabaseTraffic({operation:"REALTIME_METADATA_IGNORED",endpoint:"runtime_checkpoint_notifications.writer_echo"});
      return;
    }
    void metadataCoordinator.notify(metadata).catch(()=>setStatus({state:"OFFLINE",code:"AUTHORITY_UNAVAILABLE"}));
  };
  const channel:RealtimeChannel=client.channel(`runtime-checkpoint-${exerciseId}`).on("postgres_changes",{event:"*",schema:"public",table:"runtime_checkpoint_notifications",filter:`exercise_id=eq.${exerciseId}`},payload=>{
    handleMetadata(payload.new);
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
    if(channelStatus==="SUBSCRIBED"&&!generationStopped()){renewalLoop?.wake();requestPublish();}
  });
  return()=>{stopped=true;if(routinePublishTimer)clearTimeout(routinePublishTimer);if(publicationRetryTimer)clearTimeout(publicationRetryTimer);stopPrepared();renewalLoop?.stop();if(ensureLeaseRenewalForCurrentWriter===ensureRenewal)ensureLeaseRenewalForCurrentWriter=undefined;if(wakeCheckpointPublicationForCurrentWriter===requestPublish)wakeCheckpointPublicationForCurrentWriter=undefined;void client.removeChannel(channel);if(generation===exerciseSyncGeneration&&lease)void repository.releaseWriter(lease);if(generation===exerciseSyncGeneration)lease=undefined;};
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
  const { data: authSubscription }=supabase.auth.onAuthStateChange((_event,session)=>{
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
    activeExerciseId=nextExerciseId;
    activeLifecycle=nextActiveLifecycle;
    switchChain=switchChain.then(async()=>{
      stopActive();
      const nextStop=await startRuntimeCheckpointSyncForExercise(activeExerciseId);
      if(stopped)nextStop();else stopActive=nextStop;
    }).catch(()=>setStatus({state:"FAILED",code:"WRITER_AUTHORITY_UNAVAILABLE"}));
  });
  return()=>{stopped=true;stopSwitch();authSubscription.subscription.unsubscribe();stopActive();};
}

export function startRuntimeCheckpointSync(): Promise<()=>void> {
  if(activeStartup)return activeStartup;
  activeStartup=startRuntimeCheckpointSyncOnce().then(stop=>()=>{stop();activeStartup=undefined;},error=>{activeStartup=undefined;throw error;});
  return activeStartup;
}
