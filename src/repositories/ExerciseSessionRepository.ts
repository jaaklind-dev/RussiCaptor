import type { ExerciseSession } from "@/models/ExerciseSession";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { immutableClone, type DeepReadonly } from "@/utils/immutable";

let snapshot: CanonicalExerciseSnapshot = { exerciseId: getCurrentExercise().id, lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 0, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 };
const listeners = new Set<() => void>();
let snapshotVersion = 0;

function publishSnapshot(next: CanonicalExerciseSnapshot): void {
  snapshot = immutableClone(next) as CanonicalExerciseSnapshot;
  snapshotVersion += 1;
  listeners.forEach(listener => listener());
}

export function getCanonicalExerciseSnapshot(): DeepReadonly<CanonicalExerciseSnapshot> { return immutableClone(snapshot); }
export function getCanonicalExerciseSnapshotVersion(): number { return snapshotVersion; }
export function subscribeToCanonicalExerciseSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function replaceCanonicalExerciseSnapshot(next: CanonicalExerciseSnapshot): void { publishSnapshot(next); }

/** Read-only compatibility projection for legacy workflow services. */
export function getExerciseSession(): ExerciseSession {
  return { exerciseId: snapshot.exerciseId, state: snapshot.lifecycleState === "RUNNING" ? "running" : snapshot.lifecycleState === "PAUSED" ? "paused" : "stopped", currentMinute: snapshot.simulationTimeSec / 60, speed: snapshot.speed };
}

function legacyMutation(patch: Partial<CanonicalExerciseSnapshot>): void {
  publishSnapshot({ ...snapshot, ...patch, version: snapshot.version + 1 });
}
/** @deprecated Production controls use ExerciseControlCommandHandler. */
export function startExerciseSession(): void { legacyMutation({ lifecycleState: "RUNNING", updatedAtWallClock: new Date().toISOString() }); }
/** @deprecated Production controls use ExerciseControlCommandHandler. */
export function pauseExerciseSession(): void { legacyMutation({ lifecycleState: "PAUSED" }); }
export function resetExerciseSession(): void {
  publishSnapshot({ exerciseId: getCurrentExercise().id, lifecycleState: "READY", simulationTimeSec: 0,
    speed: 1, version: 0, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
}
/** @deprecated Compatibility helper. */
export function setExerciseMinute(minute: number): void { legacyMutation({ simulationTimeSec: minute * 60 }); }
/** @deprecated Compatibility helper. Values outside canonical speeds are retained only for legacy tests and are never exposed by WP-22 controls. */
export function setExerciseSpeed(speed: ExerciseSession["speed"]): void { legacyMutation({ speed: (speed === 2 || speed === 4 ? speed : 1) }); }
export function restoreExerciseSession(restored: ExerciseSession | CanonicalExerciseSnapshot): void {
  if ("lifecycleState" in restored) { publishSnapshot(structuredClone(restored)); return; }
  publishSnapshot({ exerciseId: restored.exerciseId,
    lifecycleState: restored.state === "running" ? "RUNNING" : restored.state === "paused" ? "PAUSED" : "READY",
    simulationTimeSec: restored.currentMinute * 60,
    speed: restored.speed === 2 || restored.speed === 4 ? restored.speed : 1,
    version: 0, updatedAtWallClock: restored.startedAt });
}
