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
import { subscribeToSync } from "@/services/SyncService";
import { localRuntimeCheckpointStore, resolveAgainstValidatedLocalCheckpoint, resolveAuthoritativeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import {
  SupabaseRuntimeCheckpointRepository,
  type RuntimeCheckpointRepository,
} from "@/services/runtime/persistence/RuntimeCheckpointRepository";
import { getRuntimeWriterInstanceId } from "@/services/runtime/persistence/RuntimeWriterIdentityService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { publishRuntimeCheckpointTerminal, type RuntimeCheckpointPublicationTerminal } from "@/services/runtime/persistence/RuntimeCheckpointPublicationService";
import { isRemoteRuntimeLifecycleActive } from "@/services/CloudSyncService";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";

const LEASE_SECONDS = 60;
const RENEW_MS = 20_000;
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

export async function takeOverRuntimeWriter(): Promise<Status> {
  if (!supabase) return { state:"DISABLED" };
  const repository=new SupabaseRuntimeCheckpointRepository(supabase);
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId;
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
    stopClockRunner();
    return setAndReturn({state:"DISABLED",code:"EXERCISE_NOT_ACTIVE"});
  }
  const remote=await repository.loadLatest(exerciseId);
  if (!remote) return setAndReturn({state:"CONFLICT",code:"CHECKPOINT_NOT_FOUND"});
  const resolved=resolveAgainstValidatedLocalCheckpoint(checkpointForExercise(getLocalRuntimeCheckpoint(),exerciseId),remote);
  if (resolved.status==="CONFLICT" || resolved.status==="NONE") return setAndReturn({state:"CONFLICT",code:resolved.status==="CONFLICT"?resolved.code:"CHECKPOINT_NOT_FOUND"});
  const writerId=await startupAwait(getRuntimeWriterInstanceId());
  const acquired=await acquireRuntimeWriterTerminal(repository,exerciseId,writerId,remote.checkpointRevision,LEASE_SECONDS);
  if ("code" in acquired) return setAndReturn({state:"READER",code:acquired.code,revision:acquired.checkpointRevision});
  const latest=await repository.loadLatest(exerciseId);
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
  // fetch is only the CAS freshness guard; matching revision and payload hash
  // let us avoid validating another large JSON copy on the UI thread.
  acceptAuthoritativeRuntimeCheckpoint(resolved.checkpoint, true);
  return status;
}

function setAndReturn(value:Status):Status { setStatus(value); return value; }

async function startRuntimeCheckpointSyncForExercise(exerciseId: string): Promise<()=>void> {
  if (!supabase) { setStatus({state:"DISABLED"}); return()=>{}; }
  const generation = ++exerciseSyncGeneration;
  await publicationBarrier;
  const generationStopped = () => stopped || generation !== exerciseSyncGeneration;
  if (isRemoteRuntimeLifecycleActive(exerciseId) === false) {
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
  let pendingWriterEcho: Readonly<{
    payloadHash:string;
    resolve:(result:RuntimeCheckpointPublicationTerminal)=>void;
  }>|undefined;
  const runPublish=async()=>{
    publishInFlight=true;
    try {
      do {
        publishQueued=false;
        const checkpoint=getLocalRuntimeCheckpoint(); if(!checkpoint||!lease||status.state!=="WRITER"||checkpoint.checkpointRevision<=remoteRevision) return;
        const echoAcknowledgement=new Promise<Awaited<ReturnType<typeof publishRuntimeCheckpointTerminal>>>(resolve=>{
          pendingWriterEcho={payloadHash:checkpoint.payloadHash,resolve};
        });
        const result=await Promise.race([publishRuntimeCheckpointTerminal(repository,lease,remoteRevision,checkpoint),echoAcknowledgement]);
        if(generationStopped())return;
        if(pendingWriterEcho?.payloadHash===checkpoint.payloadHash)pendingWriterEcho=undefined;
        if(result.state==="PUBLISHED") { localRuntimeCheckpointStore.accept(result.checkpoint); remoteRevision=result.checkpoint.checkpointRevision; setStatus({state:"WRITER",revision:remoteRevision}); }
        else if(publicationResultRevokesWriter(result.state)) { lease=undefined; stopClockRunner(); setStatus({state:"CONFLICT",code:result.code}); return; }
        else { setStatus({state:"WRITER",code:result.code,revision:remoteRevision}); }
      } while(publishQueued);
    } finally { publishInFlight=false; }
  };
  const publish=()=>{
    if(generationStopped())return;
    if(publishInFlight){publishQueued=true;return;}
    const task=runPublish();
    publicationBarrier=task.then(()=>undefined,()=>undefined);
  };
  const stopLocal=subscribeToSync(source=>{if(source==="local") publish();});
  const stopPrepared=subscribeToLocalRuntimeCheckpointPrepared(publish);
  let renewal: ReturnType<typeof setInterval> | undefined;
  const ensureRenewal=()=>{
    if(generationStopped() || renewal || !lease || status.state!=="WRITER")return;
    renewal=setInterval(()=>{if(!lease)return; const renewingLease=lease; void renewRuntimeWriterTerminal(repository,renewingLease,LEASE_SECONDS).then(result=>{
      if(generationStopped())return;
      if("lease" in result) {
        // Ignore a late response belonging to a lease that has since been
        // replaced or explicitly released by this generation.
        if(lease?.leaseId===renewingLease.leaseId) lease=result.lease;
      } else {lease=undefined;stopClockRunner();setStatus({state:"READER",code:result.code});}
    });},RENEW_MS);
  };
  ensureLeaseRenewalForCurrentWriter=ensureRenewal;
  ensureRenewal();
  const channel:RealtimeChannel=client.channel(`runtime-checkpoint-${exerciseId}`).on("postgres_changes",{event:"*",schema:"public",table:"runtime_checkpoints",filter:`exercise_id=eq.${exerciseId}`},payload=>{
    if(generationStopped())return;
    const row=payload.new as {payload?:RuntimeCheckpointEnvelope<SharedExerciseState>;writer_instance_id?:string};
    const incoming=row.payload; if(!incoming)return;
    const currentLocal=getLocalRuntimeCheckpoint();
    if(isWriterCheckpointEcho(incoming,currentLocal,lease,row.writer_instance_id)){
      if(pendingWriterEcho?.payloadHash===incoming.payloadHash){
        const acknowledge=pendingWriterEcho.resolve;pendingWriterEcho=undefined;
        acknowledge({state:"PUBLISHED",checkpoint:incoming,reconciled:true});
      }
      else if(incoming.checkpointRevision>remoteRevision){remoteRevision=incoming.checkpointRevision;setStatus({state:"WRITER",revision:remoteRevision});}
      return;
    }
    const decision=resolveAuthoritativeCheckpoint(currentLocal,incoming);
    if(decision.status==="CONFLICT") { stopClockRunner(); setStatus({state:"CONFLICT",code:decision.code}); }
    else if(decision.status==="REMOTE"){
      if(lease){lease=undefined;stopClockRunner();setStatus({state:"CONFLICT",code:"REMOTE_SYNC_CONFLICT",revision:decision.checkpoint.checkpointRevision});}
      else {acceptAuthoritativeRuntimeCheckpoint(decision.checkpoint,false);stopClockRunner();remoteRevision=decision.checkpoint.checkpointRevision;setStatus({state:"READER",revision:remoteRevision});}
    }
  }).subscribe();
  return()=>{stopped=true;stopLocal();stopPrepared();if(renewal)clearInterval(renewal);if(ensureLeaseRenewalForCurrentWriter===ensureRenewal)ensureLeaseRenewalForCurrentWriter=undefined;void client.removeChannel(channel);if(generation===exerciseSyncGeneration&&lease)void repository.releaseWriter(lease);if(generation===exerciseSyncGeneration)lease=undefined;};
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
