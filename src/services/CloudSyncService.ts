import {
  createSharedExerciseProjection,
  getLocalRuntimeCheckpoint,
  restoreRemoteExerciseIdentity,
  restoreSharedExerciseState,
  type SharedExerciseState,
} from "@/services/StatePersistenceService";
import { isSupabaseConfigured, supabase, synchronizeRealtimeAuthorization } from "@/services/SupabaseService";
import { notifySync, subscribeToSync } from "@/services/SyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { getRuntimeReaderConvergenceState } from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import { exerciseLifecycle, resolveCurrentExercise } from "@/services/exercise/CurrentExerciseSelectionService";
import type { CurrentExerciseCandidate } from "@/services/exercise/CurrentExerciseSelectionService";
import { captureCompletedExerciseArchive } from "@/services/exercise/ExercisePreparationService";
import {
  getPendingCompletedExerciseArchives,
  markCompletedExerciseArchiveDurable,
  type CompletedExerciseArchive,
} from "@/services/exercise/CompletedExerciseArchiveService";
import {
  archiveForExercise,
  compactActiveExerciseState,
  withTerminalExerciseArchive,
} from "@/services/runtime/persistence/ActiveCheckpointCompaction";
import { estimateSupabasePayloadBytes, recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { AppState } from "react-native";
import {
  EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS,
  ExerciseDiscoveryRefreshCoordinator,
  type ExerciseDiscoveryRefreshTrigger,
} from "@/services/exercise/ExerciseDiscoveryRefreshCoordinator";
import {
  EXERCISE_PROJECTION_COALESCE_INTERVAL_MS,
  ExerciseProjectionWriteCoordinator,
  exerciseProjectionIdentity,
  type ExerciseProjectionCandidate,
  type ProjectionWriteResult,
} from "@/services/exercise/ExerciseProjectionWriteCoordinator";
import { getSharedWorkflowHead, observeSharedWorkflowHead, setSharedWorkflowConnectivity, setSharedWorkflowRealtimeLifecycle } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { restoreAuthoritativePatientSharedWorkflowState, type PatientSharedWorkflowState } from "@/services/sharedWorkflow/PatientSharedWorkflowState";
import { beginCmOwnershipProjectionHydration, completeCmOwnershipProjectionHydration } from "@/services/AssignmentRepository";
import { getOperatorSession, hasActiveRole, type OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import {
  canPublishProjectionWithPackageAuthority,
  projectionPackageAuthority,
  type ProjectionPackageAuthority,
} from "@/services/exercise/ExerciseProjectionPackageAuthority";
import {
  isRuntimeCompletionPublicationFenced,
  subscribeToRuntimeCompletionPhase,
} from "@/services/runtime/exercise/RuntimeCompletionService";
import {
  getPendingInitialExercisePublication,
  shouldPreservePendingInitialExercise,
} from "@/services/exercise/InitialExercisePublicationFence";

export type CloudSyncStatus = {
  state: "disabled" | "connecting" | "synced" | "saving" | "offline" | "error";
  syncedAt?: string;
  message?: string;
};

export type CurrentExerciseDiscoveryReadiness =
  | "PENDING"
  | "RESOLVED"
  | "CONFLICT"
  | "UNAVAILABLE";

type ExerciseStateRow = {
  exercise_id: string;
  revision: number;
  state: SharedExerciseState;
  updated_at: string;
  updated_by: string;
};

type ExerciseDiscoveryRow = {
  exercise_id: string;
  revision: number;
  exercise_session: SharedExerciseState["exerciseSession"];
  exercise_package_reference?: SharedExerciseState["exercisePackageReference"];
  updated_at: string;
  updated_by: string;
};

const EXERCISE_DISCOVERY_COLUMNS = [
  "exercise_id",
  "revision",
  "updated_at",
  "updated_by",
  "exercise_session:state->exerciseSession",
  "exercise_package_reference:state->exercisePackageReference",
].join(",");

// Keep terminal history out of the five-second discovery poll. The fallback
// query below requests at most the newest terminal row when no active exercise
// exists, preserving historical presentation without making response size grow
// with every completed exercise.
export const EXERCISE_DISCOVERY_ACTIVE_FILTER = [
  "state->exerciseSession->>lifecycleState.in.(READY,RUNNING,PAUSED)",
  "state->exerciseSession->>state.in.(ready,running,paused)",
].join(",");

/** Minimal projection used only for current-exercise selection and identity. */
export function discoveryState(row: ExerciseDiscoveryRow): SharedExerciseState {
  return {
    exerciseSession: row.exercise_session,
    exercisePackageReference: row.exercise_package_reference,
    patients: [], assignments: [], transfers: [], questions: [], labs: [],
    imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
  };
}

export function shouldFetchTerminalDiscoveryState(
  row: Pick<ExerciseDiscoveryRow, "exercise_id" | "revision" | "updated_at">,
  known?: Readonly<{ revision: number; updatedAt: string }>,
): boolean {
  return !known || row.revision > known.revision ||
    (row.revision === known.revision && row.updated_at > known.updatedAt);
}

type CloudStatusListener = (status: CloudSyncStatus) => void;

let status: CloudSyncStatus = isSupabaseConfigured
  ? { state: "connecting" }
  : { state: "disabled" };
let listeners: CloudStatusListener[] = [];
let remotePollTimer: ReturnType<typeof setInterval> | undefined;
let stopDiscoveryConnectivity: (() => void) | undefined;
let stopDiscoveryAppState: (() => void) | undefined;
let stopLocalSubscription: (() => void) | undefined;
let stopSharedWorkflowRealtime: (() => void) | undefined;
let stopCompletionFenceSubscription: (() => void) | undefined;
const remoteVersions = new Map<string, Readonly<{ revision: number; updatedAt: string }>>();
let applyingRemoteState = false;
let latestRemoteExercise: Readonly<{ exerciseId: string; lifecycleState: string }> | undefined;
let latestRemoteProjectionAuthority: ProjectionPackageAuthority | undefined;
let lastDiscoveryResponseBytes = 0;
type RemoteSelectionState = "UNRESOLVED" | "RESOLVED" | "CONFLICT";
let remoteSelectionState: RemoteSelectionState = "UNRESOLVED";
let conflictingRemoteExercises: CurrentExerciseCandidate[] = [];
let explicitlySelectedExerciseId: string | undefined;
export const CLOUD_PROJECTION_INTERVAL_MS = EXERCISE_PROJECTION_COALESCE_INTERVAL_MS;
export { EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS };

function serializedBytes(value: unknown): number {
  if (value === undefined || value === null) return 0;
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return 0; }
}

export function getConflictingRemoteExercises(): readonly CurrentExerciseCandidate[] {
  return Object.freeze(conflictingRemoteExercises.map(candidate => Object.freeze({ ...candidate })));
}

export function canPublishCloudProjection(selectionState: RemoteSelectionState): boolean {
  return selectionState === "RESOLVED";
}

/** Generic projection writes never cross the atomic completion fence. */
export function shouldSuppressCloudProjectionWrite(exerciseId: string): boolean {
  return isRuntimeCompletionPublicationFenced(exerciseId);
}

/**
 * The exercise projection is EXCON-owned. CM patient mutations are persisted
 * exclusively through the shared-workflow RPC and must never be followed by a
 * legacy whole-projection write from the CM client.
 */
export function canOperatorPublishCloudProjection(
  operator: OperatorSessionState,
  exerciseId: string,
): boolean {
  return hasActiveRole(operator, "EXCON", exerciseId);
}

export function canOperatorBootstrapCloudProjection(
  operator: OperatorSessionState,
  exerciseId: string,
  lifecycleState: string,
  remoteRevisionKnown: boolean,
): boolean {
  return lifecycleState === "READY" && !remoteRevisionKnown
    && Boolean(exerciseId)
    && hasActiveRole(operator, "EXERCISE_BOOTSTRAP");
}

export function cloudProjectionWriteMethod(
  scopedExerciseControl: boolean,
  bootstrapCreate: boolean,
): "INSERT" | "UPSERT" {
  return bootstrapCreate && !scopedExerciseControl ? "INSERT" : "UPSERT";
}

export function cloudProjectionReturnsServerRow(writeMethod: "INSERT" | "UPSERT"): boolean {
  // A bootstrap INSERT is authorized and bound by a BEFORE trigger. Asking
  // PostgREST for RETURNING data in that same statement re-evaluates SELECT
  // visibility before the trigger-bound grant is visible to the statement
  // snapshot. The committed row is already known exactly on this path.
  return writeMethod !== "INSERT";
}

export function isRemoteRuntimeLifecycleActive(exerciseId: string): boolean | undefined {
  if (!latestRemoteExercise || latestRemoteExercise.exerciseId !== exerciseId) return undefined;
  return latestRemoteExercise.lifecycleState === "RUNNING" || latestRemoteExercise.lifecycleState === "PAUSED";
}

export function waitForRemoteRuntimeLifecycleActive(
  exerciseId: string,
  read: typeof isRemoteRuntimeLifecycleActive = isRemoteRuntimeLifecycleActive,
  subscribe: typeof subscribeToCloudSyncStatus = subscribeToCloudSyncStatus,
): Promise<boolean | undefined> {
  const current = read(exerciseId);
  if (current !== false) return Promise.resolve(current);
  return new Promise(resolve => {
    const stop = subscribe(next => {
      const active = read(exerciseId);
      if (active === true) { stop(); resolve(true); }
      else if (next.state === "offline" || next.state === "error" || next.state === "disabled") {
        stop(); resolve(false);
      }
    });
  });
}

export function shouldIgnoreActiveSharedProjection(
  localExerciseId: string,
  localLifecycle: string,
  remoteExerciseId: string,
  authorityState: string,
): boolean {
  return localExerciseId === remoteExerciseId && (
    authorityState === "WRITER" || localLifecycle === "COMPLETED"
  );
}

/** A terminal row for another exercise is historical data, not a current-exercise selection. */
export function shouldIgnoreHistoricalExerciseProjection(
  localExerciseId: string,
  localLifecycle: string,
  remoteExerciseId: string,
  remoteLifecycle: string,
  authorityState = getRuntimeWriterAuthorityState(),
): boolean {
  const localIsActive = localLifecycle === "RUNNING" || localLifecycle === "PAUSED";
  const remoteIsTerminal = remoteLifecycle === "COMPLETED";
  const isDifferentExercise = localExerciseId !== remoteExerciseId;
  return localIsActive && isDifferentExercise && (
    remoteIsTerminal || authorityState === "WRITER"
  );
}

function setStatus(next: CloudSyncStatus): void {
  status = next;
  listeners.forEach((listener) => listener({ ...next }));
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return { ...status };
}

export function getCurrentExerciseDiscoveryReadiness(
  currentStatus: CloudSyncStatus = status,
): CurrentExerciseDiscoveryReadiness {
  if (remoteSelectionState === "UNRESOLVED" || currentStatus.state === "connecting") return "PENDING";
  if (remoteSelectionState === "CONFLICT") return "CONFLICT";
  if (currentStatus.state === "error" || currentStatus.state === "offline" || currentStatus.state === "disabled") {
    return "UNAVAILABLE";
  }
  return "RESOLVED";
}

export function getCloudSyncOperationalState(exerciseId = getCanonicalExerciseSnapshot().exerciseId) {
  const remote = remoteVersions.get(exerciseId);
  return Object.freeze({
    ...status,
    remoteSelectionState,
    authoritativeProjectionRevision: remote?.revision,
    authoritativeProjectionUpdatedAt: remote?.updatedAt,
    realtimeConnected: status.state === "synced" || status.state === "saving",
  });
}

export function subscribeToCloudSyncStatus(
  listener: CloudStatusListener
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

function isSharedExerciseState(value: unknown): value is SharedExerciseState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SharedExerciseState>;
  return Boolean(
    candidate.exerciseSession &&
      Array.isArray(candidate.patients) &&
      Array.isArray(candidate.assignments) &&
      Array.isArray(candidate.transfers) &&
      Array.isArray(candidate.timelineEvents)
  );
}

function applyRemoteRow(row: ExerciseStateRow): void {
  const localExercise = getCanonicalExerciseSnapshot();
  if (shouldPreservePendingInitialExercise(localExercise.exerciseId, row.exercise_id)) {
    recordSupabaseTraffic({
      operation: "INITIAL_EXERCISE_DISCOVERY_DEFERRED",
      endpoint: "exercise_states.discovery",
      avoidedRequests: 1,
    });
    return;
  }
  const known = remoteVersions.get(row.exercise_id);
  const isOlder = Boolean(known && row.revision < known.revision);
  const isSameOrOlderTimestamp =
    Boolean(known && row.revision === known.revision && row.updated_at <= known.updatedAt);

  if (!isSharedExerciseState(row.state) || isOlder || isSameOrOlderTimestamp) {
    return;
  }

  remoteVersions.set(row.exercise_id, { revision: row.revision, updatedAt: row.updated_at });
  const session = row.state.exerciseSession;
  const lifecycle = "lifecycleState" in session ? session.lifecycleState : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (shouldIgnoreHistoricalExerciseProjection(
    localExercise.exerciseId,
    localExercise.lifecycleState,
    session.exerciseId,
    lifecycle,
  )) {
    setStatus({ state: "synced", syncedAt: row.updated_at });
    return;
  }
  latestRemoteExercise = { exerciseId: session.exerciseId, lifecycleState: lifecycle };
  latestRemoteProjectionAuthority = projectionPackageAuthority(row.state);
  // Active canonical Runtime is synchronized only through WP-44B checkpoint
  // authority. The shared projection must never replace it directly.
  if (lifecycle === "RUNNING" || lifecycle === "PAUSED") {
    const isSameExercise = localExercise.exerciseId === session.exerciseId;
    // Shared state is discovery-only for an active Runtime. Never let an own
    // writer echo, or a delayed active echo after Complete, roll canonical
    // lifecycle identity backwards. Runtime checkpoints own active continuity.
    if (isSameExercise && shouldIgnoreActiveSharedProjection(
      localExercise.exerciseId,
      localExercise.lifecycleState,
      session.exerciseId,
      getRuntimeWriterAuthorityState(),
    )) {
      setStatus({ state: "synced", syncedAt: row.updated_at });
      return;
    }
    applyingRemoteState = true;
    restoreRemoteExerciseIdentity(row.state);
    notifySync("remote");
    applyingRemoteState = false;
    setStatus({ state: "synced", syncedAt: row.updated_at });
    return;
  }
  applyingRemoteState = true;
  restoreSharedExerciseState(row.state);
  notifySync("remote");
  applyingRemoteState = false;
  setStatus({ state: "synced", syncedAt: row.updated_at });
}

async function refreshSharedWorkflowPatients(cloudClient: NonNullable<typeof supabase>): Promise<boolean> {
  if (remoteSelectionState !== "RESOLVED") return false;
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  beginCmOwnershipProjectionHydration(exerciseId);
  const { data, error } = await cloudClient.from("shared_workflow_patient_states")
    .select("exercise_id,patient_id,revision,owner_user_id,state")
    .eq("exercise_id", exerciseId);
  recordSupabaseTraffic({ operation: "SELECT", endpoint: "shared_workflow.patient_heads", data });
  if (error || !data) return false;
  for (const candidate of data) {
    const authoritative = candidate as {exercise_id:string;patient_id:string;revision:number;owner_user_id?:string;state:PatientSharedWorkflowState};
    const known = getSharedWorkflowHead(authoritative.exercise_id, authoritative.patient_id);
    if (authoritative.revision < known.revision) continue;
    if (!restoreAuthoritativePatientSharedWorkflowState({exerciseId:authoritative.exercise_id,patientId:authoritative.patient_id,
      revision:authoritative.revision,ownerUserId:authoritative.owner_user_id,state:authoritative.state,
      preserveCanonicalRuntime:sharedWorkflowHydrationMustPreserveCanonicalRuntime(authoritative.exercise_id)})) return false;
    observeSharedWorkflowHead(authoritative.exercise_id,authoritative.patient_id,authoritative.revision,authoritative.owner_user_id);
  }
  completeCmOwnershipProjectionHydration(exerciseId);
  notifySync("remote");
  return true;
}

export function sharedWorkflowHydrationMustPreserveCanonicalRuntime(exerciseId: string): boolean {
  const checkpoint = getLocalRuntimeCheckpoint();
  if (checkpoint?.exerciseId !== exerciseId) return false;
  const authority = getRuntimeWriterAuthorityState();
  if (authority === "WRITER" || authority === "ACQUIRING") return true;
  const reader = getRuntimeReaderConvergenceState();
  return authority === "READER" && reader.exerciseId === exerciseId && reader.phase === "READY" &&
    reader.appliedRevision === checkpoint.checkpointRevision && reader.payloadHash === checkpoint.payloadHash;
}

async function performRemoteCurrentExerciseRefresh(_trigger: ExerciseDiscoveryRefreshTrigger): Promise<void> {
  if (!supabase) return;
  const { data: activeRows, error } = await supabase
      .from("exercise_states")
      .select(EXERCISE_DISCOVERY_COLUMNS)
      .or(EXERCISE_DISCOVERY_ACTIVE_FILTER)
      .order("updated_at", { ascending: false });
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.discovery_active", data: activeRows });
    lastDiscoveryResponseBytes = serializedBytes(activeRows);
    if (error) { setStatus({ state: "error", message: error.message }); return; }
    let discoveryRows = (activeRows ?? []) as unknown as ExerciseDiscoveryRow[];
    if (discoveryRows.length === 0) {
      const { data: terminalRows, error: terminalError } = await supabase
        .from("exercise_states")
        .select(EXERCISE_DISCOVERY_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(1);
      recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.discovery_terminal", data: terminalRows });
      lastDiscoveryResponseBytes += serializedBytes(terminalRows);
      if (terminalError) { setStatus({ state: "error", message: terminalError.message }); return; }
      discoveryRows = (terminalRows ?? []) as unknown as ExerciseDiscoveryRow[];
    }
    const pendingPublication = getPendingInitialExercisePublication();
    if (pendingPublication) {
      const pendingRow = discoveryRows.find(row => row.exercise_id === pendingPublication.exerciseId);
      if (!pendingRow) {
        // The provisional READY identity must survive the read-before-insert
        // window. Reads remain enabled; only applying an unrelated historical
        // row is deferred until the first durable insert is acknowledged.
        conflictingRemoteExercises = [];
        explicitlySelectedExerciseId = undefined;
        remoteSelectionState = "RESOLVED";
        return;
      }
      discoveryRows = [pendingRow];
    }
    const candidates = discoveryRows.map(row => ({
      exerciseId: row.exercise_id,
      revision: row.revision,
      state: discoveryState(row),
      updatedAt: row.updated_at,
    }));
    const selection = resolveCurrentExercise(candidates);
    if (selection.status === "CONFLICT") {
      conflictingRemoteExercises = selection.candidates.map(candidate => ({ ...candidate }));
      const explicit = explicitlySelectedExerciseId
        ? selection.candidates.find(candidate => candidate.exerciseId === explicitlySelectedExerciseId)
        : undefined;
      remoteSelectionState = explicit ? "RESOLVED" : "CONFLICT";
      latestRemoteExercise = explicit
        ? { exerciseId: explicit.exerciseId, lifecycleState: exerciseLifecycle(explicit.state) }
        : undefined;
      setStatus({ state: "error", message: `${selection.code}:${selection.exerciseIds.join(",")}` });
      return;
    }
    conflictingRemoteExercises = [];
    if (selection.status !== "SELECTED" || selection.candidate.exerciseId !== explicitlySelectedExerciseId) explicitlySelectedExerciseId = undefined;
    if (selection.status === "SELECTED") {
      remoteSelectionState = "RESOLVED";
      const discoveryRow = discoveryRows.find(item => item.exercise_id === selection.candidate.exerciseId);
      if (discoveryRow) {
        const lifecycle = exerciseLifecycle(selection.candidate.state);
        if (lifecycle === "RUNNING" || lifecycle === "PAUSED") {
          applyRemoteRow({ exercise_id: discoveryRow.exercise_id, revision: discoveryRow.revision,
            state: selection.candidate.state, updated_at: discoveryRow.updated_at, updated_by: discoveryRow.updated_by });
        } else {
          const known = remoteVersions.get(discoveryRow.exercise_id);
          if (!shouldFetchTerminalDiscoveryState(discoveryRow, known)) {
            latestRemoteExercise = {
              exerciseId: discoveryRow.exercise_id,
              lifecycleState: lifecycle,
            };
            setStatus({ state: "synced", syncedAt: discoveryRow.updated_at });
            return;
          }
          const { data: selectedRow, error: selectedError } = await supabase.from("exercise_states")
            .select("exercise_id,revision,state,updated_at,updated_by")
            .eq("exercise_id", discoveryRow.exercise_id).single();
          recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.full_state", data: selectedRow, fullSnapshot: true });
          if (selectedError) { setStatus({ state: "error", message: selectedError.message }); return; }
          applyRemoteRow(selectedRow as ExerciseStateRow);
        }
      }
    } else {
      remoteSelectionState = "RESOLVED";
      await saveToCloud();
    }
}

const discoveryRefreshCoordinator = new ExerciseDiscoveryRefreshCoordinator(
  performRemoteCurrentExerciseRefresh,
  metric => recordSupabaseTraffic(metric),
  () => lastDiscoveryResponseBytes,
);

export function refreshRemoteCurrentExercise(trigger: ExerciseDiscoveryRefreshTrigger = "manual"): Promise<void> {
  return discoveryRefreshCoordinator.request(trigger);
}

/** Explicitly resolves a previously discovered authoritative conflict. */
export function selectConflictingRemoteExercise(exerciseId: string): boolean {
  if (remoteSelectionState !== "CONFLICT") return false;
  const selected = conflictingRemoteExercises.find(candidate => candidate.exerciseId === exerciseId);
  if (!selected) return false;
  remoteSelectionState = "RESOLVED";
  explicitlySelectedExerciseId = exerciseId;
  conflictingRemoteExercises = [];
  const lifecycle = exerciseLifecycle(selected.state);
  if (lifecycle === "RUNNING" || lifecycle === "PAUSED") {
    applyRemoteRow({ exercise_id: selected.exerciseId, revision: selected.revision,
      state: selected.state, updated_at: selected.updatedAt, updated_by: "remote-conflict-selection" });
  } else {
    void supabase?.from("exercise_states").select("exercise_id,revision,state,updated_at,updated_by")
      .eq("exercise_id", selected.exerciseId).single().then(({data,error})=>{
        recordSupabaseTraffic({operation:"SELECT",endpoint:"exercise_states.conflict_selected_full_state",data,fullSnapshot:true});
        if(error){setStatus({state:"error",message:error.message});return;}
        applyRemoteRow(data as ExerciseStateRow);
      });
  }
  return true;
}

/**
 * Reconciles a terminal checkpoint restored after an explicit conflict choice
 * back to the discovery projection for that exact exercise. Active reader
 * state is deliberately never published through this path.
 */
export async function publishExplicitlySelectedTerminalExercise(): Promise<boolean> {
  const snapshot = getCanonicalExerciseSnapshot();
  if (snapshot.lifecycleState !== "COMPLETED" || snapshot.exerciseId !== explicitlySelectedExerciseId) return false;
  await saveToCloud();
  return true;
}

type PreparedCloudProjection = Readonly<{
  exerciseId: string;
  lifecycleState: string;
  writeMethod: "INSERT" | "UPSERT";
  savedSession: SharedExerciseState["exerciseSession"];
  sharedProjection: SharedExerciseState;
}>;

function prepareCloudProjection(): ExerciseProjectionCandidate<PreparedCloudProjection> | undefined {
  if (!supabase || applyingRemoteState || !canPublishCloudProjection(remoteSelectionState)) return undefined;
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  if (shouldSuppressCloudProjectionWrite(exerciseId)) {
    recordSupabaseTraffic({ operation: "PROJECTION_WRITE_COMPLETION_FENCE_SUPPRESSED", endpoint: "exercise_states.projection",
      avoidedRequests: 1 });
    return undefined;
  }
  const baseProjection = compactActiveExerciseState(createSharedExerciseProjection());
  const savedSession = baseProjection.exerciseSession;
  const lifecycleState = "lifecycleState" in savedSession
    ? savedSession.lifecycleState
      : savedSession.state === "running" ? "RUNNING" : savedSession.state === "paused" ? "PAUSED" : "READY";
  const operator = getOperatorSession();
  const scopedExerciseControl = canOperatorPublishCloudProjection(operator, exerciseId);
  const bootstrapCreate = canOperatorBootstrapCloudProjection(
    operator,
    exerciseId,
    lifecycleState,
    remoteVersions.has(exerciseId),
  );
  if (!scopedExerciseControl && !bootstrapCreate) return undefined;
  // Terminal checkpoint and discovery projection are committed by one fenced
  // RPC; a separate projection write could otherwise reintroduce split-brain.
  if (shouldSuppressCloudProjectionWrite(exerciseId)) return undefined;
  const sharedProjection = lifecycleState === "COMPLETED"
    ? withTerminalExerciseArchive(baseProjection, captureCompletedExerciseArchive())
    : baseProjection;
  if (!canPublishProjectionWithPackageAuthority(
    sharedProjection,
    latestRemoteProjectionAuthority,
    getLocalRuntimeCheckpoint(),
  )) {
    recordSupabaseTraffic({ operation: "PROJECTION_PACKAGE_DIVERGENCE_REJECTED", endpoint: "exercise_states.projection" });
    setStatus({ state: "error", message: "PACKAGE_PROJECTION_DIVERGENCE" });
    return undefined;
  }
  const { identity, payloadBytes } = exerciseProjectionIdentity(sharedProjection);
  return { identity, payloadBytes,
    value: { exerciseId, lifecycleState,
      writeMethod: cloudProjectionWriteMethod(scopedExerciseControl, bootstrapCreate),
      savedSession, sharedProjection } };
}

async function publishCloudProjection(candidate: ExerciseProjectionCandidate<PreparedCloudProjection>): Promise<ProjectionWriteResult> {
  if (!supabase) return false;

  const { exerciseId, lifecycleState, writeMethod, savedSession, sharedProjection } = candidate.value;
  if (shouldSuppressCloudProjectionWrite(exerciseId)) {
    recordSupabaseTraffic({ operation: "PROJECTION_WRITE_COMPLETION_FENCE_SUPPRESSED", endpoint: "exercise_states.projection",
      avoidedRequests: 1, estimatedBytesSaved: candidate.payloadBytes });
    return "SUPPRESSED";
  }

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return false;

  // Completion may become fenced while the asynchronous auth lookup is in
  // flight. Re-check immediately before the first backend write.
  if (shouldSuppressCloudProjectionWrite(exerciseId)) {
    recordSupabaseTraffic({ operation: "PROJECTION_WRITE_COMPLETION_FENCE_SUPPRESSED", endpoint: "exercise_states.projection",
      avoidedRequests: 1, estimatedBytesSaved: candidate.payloadBytes });
    return "SUPPRESSED";
  }
  const nextRevision = (remoteVersions.get(exerciseId)?.revision ?? 0) + 1;
  setStatus({ state: "saving", syncedAt: status.syncedAt });
  const projectionRow = {
    exercise_id: exerciseId,
    revision: nextRevision,
    state: sharedProjection,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  };
  let row: Pick<ExerciseStateRow, "exercise_id" | "revision" | "updated_at">;
  if (cloudProjectionReturnsServerRow(writeMethod)) {
    const { data, error } = await supabase.from("exercise_states")
      .upsert(projectionRow, { onConflict: "exercise_id" })
      .select("exercise_id,revision,updated_at")
      .single();
    recordSupabaseTraffic({ operation: writeMethod, endpoint: "exercise_states.projection", data,
      requestBytes: candidate.payloadBytes });
    if (error) {
      setStatus({ state: "offline", syncedAt: status.syncedAt, message: error.message });
      return false;
    }
    row = data as Pick<ExerciseStateRow, "exercise_id" | "revision" | "updated_at">;
  } else {
    const { error } = await supabase.from("exercise_states").insert(projectionRow);
    recordSupabaseTraffic({ operation: writeMethod, endpoint: "exercise_states.projection",
      data: error ? undefined : { exercise_id: exerciseId, revision: nextRevision, updated_at: projectionRow.updated_at },
      requestBytes: candidate.payloadBytes });
    if (error) {
      setStatus({ state: "offline", syncedAt: status.syncedAt, message: error.message });
      return false;
    }
    row = { exercise_id: exerciseId, revision: nextRevision, updated_at: projectionRow.updated_at };
  }

  remoteVersions.set(row.exercise_id, { revision: row.revision, updatedAt: row.updated_at });
  if (lifecycleState === "COMPLETED") markCompletedExerciseArchiveDurable(exerciseId);
  latestRemoteExercise = {
    exerciseId: savedSession.exerciseId,
    lifecycleState: "lifecycleState" in savedSession
      ? savedSession.lifecycleState
      : savedSession.state === "running" ? "RUNNING" : savedSession.state === "paused" ? "PAUSED" : "READY",
  };
  latestRemoteProjectionAuthority = projectionPackageAuthority(sharedProjection);
  setStatus({ state: "synced", syncedAt: row.updated_at });
  return true;
}

const projectionWriteCoordinator = new ExerciseProjectionWriteCoordinator(
  prepareCloudProjection,
  publishCloudProjection,
  metric => recordSupabaseTraffic(metric),
  EXERCISE_PROJECTION_COALESCE_INTERVAL_MS,
  candidate => shouldSuppressCloudProjectionWrite(candidate?.value.exerciseId ?? getCanonicalExerciseSnapshot().exerciseId),
);

async function saveToCloud(): Promise<void> { await projectionWriteCoordinator.flush(); }

export type InitialExercisePublicationAcknowledgement = Readonly<{
  exerciseId: string;
  revision: number;
  packageId: string;
  packageVersion: string;
  bootstrapAuthorizationId: string;
}>;

export type InitialExerciseReadback = Readonly<{
  exercise_id: string;
  revision: number;
  exercise_session?: SharedExerciseState["exerciseSession"];
  exercise_package_reference?: SharedExerciseState["exercisePackageReference"];
  updated_at: string;
}>;

export type BootstrapConsumptionReadback = Readonly<{
  id: string;
  status: string;
  consumed_exercise_id: string | null;
  consumed_at: string | null;
  expires_at: string;
}>;

const INITIAL_EXERCISE_ACK_DELAYS_MS = Object.freeze([0, 150, 300, 600, 1_200, 2_400]);

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export type InitialExercisePublicationPort = Readonly<{
  authenticatedUserId(): Promise<string | undefined>;
  projection(): SharedExerciseState;
  readExercise(exerciseId: string): Promise<InitialExerciseReadback | undefined>;
  readBootstrap(bootstrapId: string, userId: string): Promise<BootstrapConsumptionReadback | undefined>;
  insert(row: ExerciseStateRow): Promise<void>;
  discover(exerciseId: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
}>;

function initialExercisePublicationPort(): InitialExercisePublicationPort {
  if (!supabase) throw new Error("ADMIN_EXERCISE_DURABILITY_UNAVAILABLE");
  const client = supabase;
  return {
    authenticatedUserId: async () => {
      const { data, error } = await client.auth.getUser();
      return error ? undefined : data.user?.id;
    },
    projection: () => compactActiveExerciseState(createSharedExerciseProjection()),
    readExercise: async exerciseId => {
      const { data, error } = await client.from("exercise_states")
        .select(EXERCISE_DISCOVERY_COLUMNS).eq("exercise_id", exerciseId).maybeSingle();
      recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.initial_create_ack", data });
      if (error) throw new Error("ADMIN_EXERCISE_READBACK_FAILED");
      return data as unknown as InitialExerciseReadback | undefined;
    },
    readBootstrap: async (bootstrapId, userId) => {
      const { data, error } = await client.from("exercise_bootstrap_authorizations")
        .select("id,status,consumed_exercise_id,consumed_at,expires_at")
        .eq("id", bootstrapId).eq("user_id", userId).maybeSingle();
      recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_bootstrap_authorizations.initial_create_ack", data });
      if (error) throw new Error("ADMIN_EXERCISE_BOOTSTRAP_READBACK_FAILED");
      return data as BootstrapConsumptionReadback | undefined;
    },
    insert: async row => {
      const { error } = await client.from("exercise_states").insert(row);
      recordSupabaseTraffic({ operation: "INSERT", endpoint: "exercise_states.admin_initial_create",
        requestBytes: estimateSupabasePayloadBytes(row) });
      if (error) throw new Error("ADMIN_EXERCISE_INITIAL_INSERT_FAILED");
    },
    discover: async exerciseId => {
      await refreshRemoteCurrentExercise("manual");
      return latestRemoteExercise?.exerciseId === exerciseId && remoteVersions.has(exerciseId);
    },
    wait: delay,
  };
}

export function initialExerciseReadbackMatches(
  row: InitialExerciseReadback | undefined,
  exerciseId: string,
  packageId: string,
  packageVersion: string,
): row is InitialExerciseReadback {
  if (!row || row.exercise_id !== exerciseId || row.revision < 1) return false;
  const session = row.exercise_session;
  const reference = row.exercise_package_reference;
  const lifecycle = session && "lifecycleState" in session
    ? session.lifecycleState
    : session?.state === "running" ? "RUNNING" : session?.state === "paused" ? "PAUSED" : "READY";
  return session?.exerciseId === exerciseId
    && lifecycle === "READY"
    && reference?.packageId === packageId
    && reference.packageVersion === packageVersion;
}

export function bootstrapConsumptionMatches(
  row: BootstrapConsumptionReadback | undefined,
  exerciseId: string,
): row is BootstrapConsumptionReadback {
  return Boolean(row?.id && row.status === "ACTIVE"
    && row.consumed_exercise_id === exerciseId && row.consumed_at);
}

/**
 * Forces the one-shot READY insert and waits for independent backend readback.
 * No Runtime checkpoint is required at READY: bootstrap authority deliberately
 * cannot create a writer lease or runtime_checkpoints row.
 */
export async function acknowledgeInitialExercisePublication(input: Readonly<{
  operationId: string;
  userId: string;
  exerciseId: string;
  packageId: string;
  packageVersion: string;
  bootstrapAuthorizationId: string;
  /** Detached Admin READY projection; ordinary callers still use the current store. */
  projection?: SharedExerciseState;
}>, port: InitialExercisePublicationPort = initialExercisePublicationPort()): Promise<InitialExercisePublicationAcknowledgement> {
  const pending = getPendingInitialExercisePublication();
  if (!pending || pending.operationId !== input.operationId || pending.exerciseId !== input.exerciseId) {
    throw new Error("ADMIN_EXERCISE_CREATE_IDENTITY_MISMATCH");
  }

  if (await port.authenticatedUserId() !== input.userId) throw new Error("ADMIN_EXERCISE_AUTH_MISMATCH");
  const projection = input.projection ?? port.projection();
  if (!initialExerciseProjectionMatches(projection, input.exerciseId, input.packageId, input.packageVersion)) {
    throw new Error("ADMIN_EXERCISE_PROJECTION_MISMATCH");
  }

  // A lost INSERT response may already have committed the one-shot bootstrap.
  // Read the exact identity first; never issue a second INSERT for that case.
  const prior = await port.readExercise(input.exerciseId);
  if (prior && !initialExerciseReadbackMatches(prior,
    input.exerciseId, input.packageId, input.packageVersion)) throw new Error("ADMIN_EXERCISE_CREATE_ACK_MISMATCH");
  if (!prior) {
    const bootstrap = await port.readBootstrap(input.bootstrapAuthorizationId, input.userId);
    const expiresAtMs = Date.parse(bootstrap?.expires_at ?? "");
    if (!bootstrap || bootstrap.status !== "ACTIVE" || bootstrap.consumed_exercise_id
      || bootstrap.consumed_at || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new Error("ADMIN_EXERCISE_BOOTSTRAP_UNAVAILABLE");
    }
    const row = { exercise_id: input.exerciseId, revision: 1, state: projection,
      updated_at: new Date().toISOString(), updated_by: input.userId };
    await port.insert(row);
  }

  for (const waitMs of INITIAL_EXERCISE_ACK_DELAYS_MS) {
    await port.wait(waitMs);
    let exerciseRow: InitialExerciseReadback | undefined;
    let bootstrapRow: BootstrapConsumptionReadback | undefined;
    try {
      [exerciseRow, bootstrapRow] = await Promise.all([
        port.readExercise(input.exerciseId), port.readBootstrap(input.bootstrapAuthorizationId, input.userId),
      ]);
    } catch { continue; }
    if (!initialExerciseReadbackMatches(exerciseRow, input.exerciseId, input.packageId, input.packageVersion)
      || !bootstrapConsumptionMatches(bootstrapRow, input.exerciseId)
      || bootstrapRow.id !== input.bootstrapAuthorizationId) continue;

    if (!await port.discover(input.exerciseId)) continue;
    return Object.freeze({
      exerciseId: input.exerciseId,
      revision: exerciseRow.revision,
      packageId: input.packageId,
      packageVersion: input.packageVersion,
      bootstrapAuthorizationId: bootstrapRow.id,
    });
  }
  throw new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT");
}

export function initialExerciseProjectionMatches(state: SharedExerciseState,
  exerciseId: string, packageId: string, packageVersion: string): boolean {
  const session = state.exerciseSession;
  return session.exerciseId === exerciseId
    && "lifecycleState" in session && session.lifecycleState === "READY"
    && session.simulationTimeSec === 0 && session.speed === 1
    && typeof session.lastCommandId === "string" && session.lastCommandId.startsWith("PREPARE-")
    && state.exercisePackageReference?.packageId === packageId
    && state.exercisePackageReference.packageVersion === packageVersion;
}

/**
 * Moves legacy checkpoint-carried evidence to the historical row that owns it.
 * A failed or missing row remains pending in the local checkpoint, so compaction
 * never trades bounded size for evidence loss.
 */
export async function migratePendingCompletedExerciseArchives(userId: string): Promise<number> {
  if (!supabase) return 0;
  let migrated = 0;
  for (const archive of getPendingCompletedExerciseArchives()) {
    const { data, error } = await supabase.from("exercise_states")
      .select("exercise_id,revision,state,updated_at,updated_by")
      .eq("exercise_id", archive.exerciseId)
      .single();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.archive_migration_full_state", data, fullSnapshot: true });
    if (error || !data) continue;
    const row = data as ExerciseStateRow;
    if (!isSharedExerciseState(row.state)) continue;
    const existing = archiveForExercise(row.state.completedExerciseArchives, archive.exerciseId);
    if (!existing) {
      if (shouldSuppressCloudProjectionWrite(archive.exerciseId)) {
        recordSupabaseTraffic({ operation: "PROJECTION_WRITE_COMPLETION_FENCE_SUPPRESSED",
          endpoint: "exercise_states.terminal_archive", avoidedRequests: 1 });
        continue;
      }
      const terminalState = withTerminalExerciseArchive(row.state, archive);
      if (!terminalState.completedExerciseArchives) continue;
      const archiveWrite = {
        exercise_id: row.exercise_id,
        revision: row.revision + 1,
        state: terminalState,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      };
      const { error: writeError } = await supabase.from("exercise_states").upsert(
        archiveWrite, { onConflict: "exercise_id" });
      recordSupabaseTraffic({ operation: "UPSERT", endpoint: "exercise_states.terminal_archive",
        requestBytes: estimateSupabasePayloadBytes(archiveWrite) });
      if (writeError) continue;
    }
    markCompletedExerciseArchiveDurable(archive.exerciseId);
    migrated += 1;
  }
  if (migrated > 0) notifySync("local");
  return migrated;
}

/** Reads historical evidence from its durable terminal exercise row, never from the active checkpoint. */
export async function loadCompletedExerciseArchive(exerciseId: string): Promise<CompletedExerciseArchive | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from("exercise_states")
    .select("completed_exercise_archives:state->completedExerciseArchives")
    .eq("exercise_id", exerciseId)
    .single();
  recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.completed_archive", data });
  if (error) return undefined;
  const row = data as unknown as { completed_exercise_archives?: CompletedExerciseArchive[] };
  return archiveForExercise(row.completed_exercise_archives, exerciseId);
}

function scheduleCloudSave(): void {
  if (!canPublishCloudProjection(remoteSelectionState)) return;
  const snapshot = getCanonicalExerciseSnapshot();
  if (shouldSuppressCloudProjectionWrite(snapshot.exerciseId)) {
    projectionWriteCoordinator.discardPending();
    return;
  }
  const lifecycleBoundary = !latestRemoteExercise ||
    latestRemoteExercise.exerciseId !== snapshot.exerciseId ||
    latestRemoteExercise.lifecycleState !== snapshot.lifecycleState;
  if (lifecycleBoundary) {
    projectionWriteCoordinator.schedule(true);
    return;
  }
  projectionWriteCoordinator.schedule();
}

export async function startCloudSync(): Promise<() => void> {
  if (!supabase) {
    setStatus({ state: "disabled" });
    return () => {};
  }
  const cloudClient = supabase;

  setStatus({ state: "connecting" });
  setSharedWorkflowConnectivity(false);
  remoteSelectionState = "UNRESOLVED";
  latestRemoteProjectionAuthority = undefined;
  conflictingRemoteExercises = [];
  explicitlySelectedExerciseId = undefined;

  projectionWriteCoordinator.reset();
  stopLocalSubscription?.(); stopLocalSubscription = undefined;
  stopSharedWorkflowRealtime?.(); stopSharedWorkflowRealtime = undefined;
  stopCompletionFenceSubscription?.(); stopCompletionFenceSubscription = undefined;
  if (remotePollTimer) { clearInterval(remotePollTimer); remotePollTimer = undefined; }
  stopDiscoveryConnectivity?.(); stopDiscoveryConnectivity = undefined;
  stopDiscoveryAppState?.(); stopDiscoveryAppState = undefined;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session || sessionData.session.user.is_anonymous) {
    setStatus({ state: "error", message: "Autenditud operaatori seanss puudub." });
    return () => {};
  }
  if (!await synchronizeRealtimeAuthorization()) {
    setStatus({ state: "error", message: "Realtime’i autentimine ebaõnnestus." });
    return () => {};
  }

  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) await migratePendingCompletedExerciseArchives(authData.user.id);

  await refreshRemoteCurrentExercise("startup");

  // Never subscribe to exercise_states: Postgres Changes would transfer its
  // complete state JSON. This payload-free channel is connectivity-only; a
  // successful resubscription invalidates discovery after a missed interval.
  let subscribedOnce = false;
  let reconnectPending = false;
  let stopped = false;
  const connectivityChannel = cloudClient.channel("exercise-discovery-connectivity").subscribe(channelStatus => {
    if (stopped) return;
    if (channelStatus === "SUBSCRIBED") {
      if (subscribedOnce && reconnectPending) {
        recordSupabaseTraffic({ operation: "DISCOVERY_REALTIME_INVALIDATION", endpoint: "exercise_states.discovery_reconnect", reconnect: true });
        void refreshRemoteCurrentExercise("reconnect");
        scheduleCloudSave();
      }
      subscribedOnce = true;
      reconnectPending = false;
    } else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT" || channelStatus === "CLOSED") {
      if (subscribedOnce) reconnectPending = true;
    }
  });
  stopDiscoveryConnectivity = () => { stopped = true; void cloudClient.removeChannel(connectivityChannel); };

  // Realtime carries only patient/revision metadata. The authoritative patient
  // payload is fetched on demand, avoiding a full exercise projection echo.
  const workflowChannel=cloudClient.channel("shared-workflow-notifications")
    .on("postgres_changes",{event:"*",schema:"public",table:"shared_workflow_notifications"},payload=>{
      const row=payload.new as {exercise_id?:string;patient_id?:string;revision?:number};
      if(!row.exercise_id||!row.patient_id||row.exercise_id!==getCanonicalExerciseSnapshot().exerciseId)return;
      void cloudClient.from("shared_workflow_patient_states").select("exercise_id,patient_id,revision,owner_user_id,state")
        .eq("exercise_id",row.exercise_id).eq("patient_id",row.patient_id).single().then(({data,error})=>{
          recordSupabaseTraffic({operation:"SELECT",endpoint:"shared_workflow.patient_state",data});if(error||!data)return;
          const authoritative=data as {exercise_id:string;patient_id:string;revision:number;owner_user_id?:string;state:PatientSharedWorkflowState};
          if(!restoreAuthoritativePatientSharedWorkflowState({exerciseId:authoritative.exercise_id,patientId:authoritative.patient_id,
            revision:authoritative.revision,ownerUserId:authoritative.owner_user_id,state:authoritative.state,
            preserveCanonicalRuntime:sharedWorkflowHydrationMustPreserveCanonicalRuntime(authoritative.exercise_id)}))return;
          observeSharedWorkflowHead(authoritative.exercise_id,authoritative.patient_id,authoritative.revision,authoritative.owner_user_id);
          notifySync("remote");
        });
    }).subscribe(channelStatus=>{
      setSharedWorkflowRealtimeLifecycle(channelStatus);
      if(channelStatus!=="SUBSCRIBED"){setSharedWorkflowConnectivity(false);return;}
      // Subscribe first, then hydrate. This ordering closes the startup window:
      // an update racing with hydration is either in the result or notified.
      void refreshSharedWorkflowPatients(cloudClient).then(hydrated=>setSharedWorkflowConnectivity(hydrated));
    });
  stopSharedWorkflowRealtime=()=>{setSharedWorkflowRealtimeLifecycle("CLOSED");setSharedWorkflowConnectivity(false);void cloudClient.removeChannel(workflowChannel);};

  // A 60-second safety query bounds missed-event discovery while reducing the
  // previous stable cadence from 720 to 60 requests/hour (91.7%).
  remotePollTimer = setInterval(() => { void discoveryRefreshCoordinator.safetyPoll(); }, EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS);

  let previousAppState = AppState.currentState ?? "active";
  const appStateSubscription = AppState.addEventListener("change", nextState => {
    const returnedToForeground = nextState === "active" && previousAppState !== "active";
    previousAppState = nextState;
    if (returnedToForeground) {
      recordSupabaseTraffic({ operation: "DISCOVERY_FOREGROUND_INVALIDATION", endpoint: "exercise_states.discovery_foreground" });
      void refreshRemoteCurrentExercise("foreground").then(() =>
        refreshSharedWorkflowPatients(cloudClient).then(hydrated=>setSharedWorkflowConnectivity(hydrated)));
      scheduleCloudSave();
    } else if (nextState !== "active") {
      void projectionWriteCoordinator.flush();
    }
  });
  stopDiscoveryAppState = () => appStateSubscription.remove();
  if (status.state === "connecting") setStatus({ state: "synced", syncedAt: new Date().toISOString() });

  stopLocalSubscription = subscribeToSync((source) => {
    if (source === "local") scheduleCloudSave();
  });

  // The completion coordinator is authoritative for both generic publishers.
  // Discard queued RUNNING work as soon as PENDING/FINALIZING is observable;
  // reads, discovery and Realtime subscriptions remain active.
  stopCompletionFenceSubscription = subscribeToRuntimeCompletionPhase(() => {
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    if (shouldSuppressCloudProjectionWrite(exerciseId)) projectionWriteCoordinator.discardPending();
  });

  return () => {
    projectionWriteCoordinator.reset();
    stopLocalSubscription?.();
    stopLocalSubscription = undefined;
    if (remotePollTimer) clearInterval(remotePollTimer);
    remotePollTimer = undefined;
    stopDiscoveryConnectivity?.(); stopDiscoveryConnectivity = undefined;
    stopSharedWorkflowRealtime?.(); stopSharedWorkflowRealtime = undefined;
    stopCompletionFenceSubscription?.(); stopCompletionFenceSubscription = undefined;
    stopDiscoveryAppState?.(); stopDiscoveryAppState = undefined;
  };
}
