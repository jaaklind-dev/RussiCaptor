import {
  createSharedExerciseProjection,
  restoreRemoteExerciseIdentity,
  restoreSharedExerciseState,
  type SharedExerciseState,
} from "@/services/StatePersistenceService";
import { isSupabaseConfigured, supabase } from "@/services/SupabaseService";
import { notifySync, subscribeToSync } from "@/services/SyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { exerciseLifecycle, resolveCurrentExercise } from "@/services/exercise/CurrentExerciseSelectionService";
import type { CurrentExerciseCandidate } from "@/services/exercise/CurrentExerciseSelectionService";

export type CloudSyncStatus = {
  state: "disabled" | "connecting" | "synced" | "saving" | "offline" | "error";
  syncedAt?: string;
  message?: string;
};

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
let stopLocalSubscription: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const remoteVersions = new Map<string, Readonly<{ revision: number; updatedAt: string }>>();
let applyingRemoteState = false;
let latestRemoteExercise: Readonly<{ exerciseId: string; lifecycleState: string }> | undefined;
let refreshingRemoteSelection = false;
type RemoteSelectionState = "UNRESOLVED" | "RESOLVED" | "CONFLICT";
let remoteSelectionState: RemoteSelectionState = "UNRESOLVED";
let conflictingRemoteExercises: CurrentExerciseCandidate[] = [];
let explicitlySelectedExerciseId: string | undefined;
export const CLOUD_PROJECTION_INTERVAL_MS = 5_000;

export function getConflictingRemoteExercises(): readonly CurrentExerciseCandidate[] {
  return Object.freeze(conflictingRemoteExercises.map(candidate => Object.freeze({ ...candidate })));
}

export function canPublishCloudProjection(selectionState: RemoteSelectionState): boolean {
  return selectionState === "RESOLVED";
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
  const localExercise = getCanonicalExerciseSnapshot();
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

export async function refreshRemoteCurrentExercise(): Promise<void> {
  if (!supabase || refreshingRemoteSelection) return;
  refreshingRemoteSelection = true;
  try {
    const { data: activeRows, error } = await supabase
      .from("exercise_states")
      .select(EXERCISE_DISCOVERY_COLUMNS)
      .or(EXERCISE_DISCOVERY_ACTIVE_FILTER)
      .order("updated_at", { ascending: false });
    if (error) { setStatus({ state: "error", message: error.message }); return; }
    let discoveryRows = (activeRows ?? []) as unknown as ExerciseDiscoveryRow[];
    if (discoveryRows.length === 0) {
      const { data: terminalRows, error: terminalError } = await supabase
        .from("exercise_states")
        .select(EXERCISE_DISCOVERY_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (terminalError) { setStatus({ state: "error", message: terminalError.message }); return; }
      discoveryRows = (terminalRows ?? []) as unknown as ExerciseDiscoveryRow[];
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
          if (selectedError) { setStatus({ state: "error", message: selectedError.message }); return; }
          applyRemoteRow(selectedRow as ExerciseStateRow);
        }
      }
    } else {
      remoteSelectionState = "RESOLVED";
      await saveToCloud();
    }
  } finally {
    refreshingRemoteSelection = false;
  }
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

async function saveToCloud(): Promise<void> {
  if (!supabase || applyingRemoteState || !canPublishCloudProjection(remoteSelectionState)) return;

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return;

  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const nextRevision = (remoteVersions.get(exerciseId)?.revision ?? 0) + 1;
  setStatus({ state: "saving", syncedAt: status.syncedAt });

  const sharedProjection = createSharedExerciseProjection();
  const { data, error } = await supabase
    .from("exercise_states")
    .upsert(
      {
        exercise_id: exerciseId,
        revision: nextRevision,
        state: sharedProjection,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "exercise_id" }
    )
    .select("exercise_id,revision,updated_at")
    .single();

  if (error) {
    setStatus({ state: "offline", syncedAt: status.syncedAt, message: error.message });
    return;
  }

  const row = data as Pick<ExerciseStateRow, "exercise_id" | "revision" | "updated_at">;
  remoteVersions.set(row.exercise_id, { revision: row.revision, updatedAt: row.updated_at });
  const savedSession = sharedProjection.exerciseSession;
  latestRemoteExercise = {
    exerciseId: savedSession.exerciseId,
    lifecycleState: "lifecycleState" in savedSession
      ? savedSession.lifecycleState
      : savedSession.state === "running" ? "RUNNING" : savedSession.state === "paused" ? "PAUSED" : "READY",
  };
  setStatus({ state: "synced", syncedAt: row.updated_at });
}

function scheduleCloudSave(): void {
  if (!canPublishCloudProjection(remoteSelectionState)) return;
  const snapshot = getCanonicalExerciseSnapshot();
  const lifecycleBoundary = !latestRemoteExercise ||
    latestRemoteExercise.exerciseId !== snapshot.exerciseId ||
    latestRemoteExercise.lifecycleState !== snapshot.lifecycleState;
  if (lifecycleBoundary) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    void saveToCloud();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveToCloud();
  }, CLOUD_PROJECTION_INTERVAL_MS);
}

export async function startCloudSync(): Promise<() => void> {
  if (!supabase) {
    setStatus({ state: "disabled" });
    return () => {};
  }

  setStatus({ state: "connecting" });
  remoteSelectionState = "UNRESOLVED";
  conflictingRemoteExercises = [];
  explicitlySelectedExerciseId = undefined;

  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
  stopLocalSubscription?.(); stopLocalSubscription = undefined;
  if (remotePollTimer) { clearInterval(remotePollTimer); remotePollTimer = undefined; }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setStatus({ state: "error", message: error.message });
      return () => {};
    }
  }

  await refreshRemoteCurrentExercise();

  // A table-wide Realtime subscription transfers the complete JSON row for
  // every update. A bounded metadata poll keeps discovery fresh without
  // downloading canonical payloads that checkpoint authority already owns.
  remotePollTimer = setInterval(() => { void refreshRemoteCurrentExercise(); }, 5_000);
  if (status.state === "connecting") setStatus({ state: "synced", syncedAt: new Date().toISOString() });

  stopLocalSubscription = subscribeToSync((source) => {
    if (source === "local") scheduleCloudSave();
  });

  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    stopLocalSubscription?.();
    stopLocalSubscription = undefined;
    if (remotePollTimer) clearInterval(remotePollTimer);
    remotePollTimer = undefined;
  };
}
