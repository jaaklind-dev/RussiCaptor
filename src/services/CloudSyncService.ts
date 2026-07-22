import type { RealtimeChannel } from "@supabase/supabase-js";

import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  createSharedExerciseSnapshot,
  restoreSharedExerciseState,
  type SharedExerciseState,
} from "@/services/StatePersistenceService";
import { isSupabaseConfigured, supabase } from "@/services/SupabaseService";
import { notifySync, subscribeToSync } from "@/services/SyncService";

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

type CloudStatusListener = (status: CloudSyncStatus) => void;

let status: CloudSyncStatus = isSupabaseConfigured
  ? { state: "connecting" }
  : { state: "disabled" };
let listeners: CloudStatusListener[] = [];
let channel: RealtimeChannel | undefined;
let stopLocalSubscription: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let latestRevision = 0;
let latestUpdatedAt = "";
let applyingRemoteState = false;

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
  const isOlder = row.revision < latestRevision;
  const isSameOrOlderTimestamp =
    row.revision === latestRevision && row.updated_at <= latestUpdatedAt;

  if (!isSharedExerciseState(row.state) || isOlder || isSameOrOlderTimestamp) {
    return;
  }

  latestRevision = row.revision;
  latestUpdatedAt = row.updated_at;
  applyingRemoteState = true;
  restoreSharedExerciseState(row.state);
  notifySync("remote");
  applyingRemoteState = false;
  setStatus({ state: "synced", syncedAt: row.updated_at });
}

async function saveToCloud(): Promise<void> {
  if (!supabase || applyingRemoteState) return;

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return;

  const nextRevision = latestRevision + 1;
  setStatus({ state: "saving", syncedAt: status.syncedAt });

  const { data, error } = await supabase
    .from("exercise_states")
    .upsert(
      {
        exercise_id: getCurrentExercise().id,
        revision: nextRevision,
        state: createSharedExerciseSnapshot(),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "exercise_id" }
    )
    .select()
    .single();

  if (error) {
    setStatus({ state: "offline", syncedAt: status.syncedAt, message: error.message });
    return;
  }

  const row = data as ExerciseStateRow;
  latestRevision = row.revision;
  latestUpdatedAt = row.updated_at;
  setStatus({ state: "synced", syncedAt: row.updated_at });
}

function scheduleCloudSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveToCloud();
  }, 500);
}

export async function startCloudSync(): Promise<() => void> {
  if (!supabase) {
    setStatus({ state: "disabled" });
    return () => {};
  }

  setStatus({ state: "connecting" });

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setStatus({ state: "error", message: error.message });
      return () => {};
    }
  }

  const { data: rows, error } = await supabase
    .from("exercise_states")
    .select()
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    setStatus({ state: "error", message: error.message });
    return () => {};
  }

  const existing = rows?.[0] as ExerciseStateRow | undefined;
  if (existing) {
    applyRemoteRow(existing);
  } else {
    await saveToCloud();
  }

  channel = supabase
    .channel("russicaptor-exercise-state")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "exercise_states" },
      (payload) => applyRemoteRow(payload.new as ExerciseStateRow)
    )
    .subscribe((channelStatus) => {
      if (channelStatus === "SUBSCRIBED" && status.state === "connecting") {
        setStatus({ state: "synced", syncedAt: new Date().toISOString() });
      }
    });

  stopLocalSubscription = subscribeToSync((source) => {
    if (source === "local") scheduleCloudSave();
  });

  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    stopLocalSubscription?.();
    stopLocalSubscription = undefined;
    if (channel) void supabase?.removeChannel(channel);
    channel = undefined;
  };
}
