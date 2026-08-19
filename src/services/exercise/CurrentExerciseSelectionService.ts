import type { SharedExerciseState } from "@/models/SharedExerciseState";

export type CurrentExerciseCandidate = Readonly<{
  exerciseId: string;
  revision: number;
  state: SharedExerciseState;
  updatedAt: string;
}>;

export type CurrentExerciseSelection = Readonly<
  | { status: "NONE" }
  | { status: "SELECTED"; candidate: CurrentExerciseCandidate }
  | { status: "CONFLICT"; code: "MULTIPLE_ACTIVE_EXERCISES"; exerciseIds: readonly string[]; candidates: readonly CurrentExerciseCandidate[] }
>;

export function exerciseLifecycle(state: SharedExerciseState): string {
  const session = state.exerciseSession;
  return "lifecycleState" in session
    ? session.lifecycleState
    : session.state === "running"
      ? "RUNNING"
      : session.state === "paused"
        ? "PAUSED"
        : "READY";
}

function newestFirst(a: CurrentExerciseCandidate, b: CurrentExerciseCandidate): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.exerciseId.localeCompare(a.exerciseId);
}

/**
 * Canonical current-exercise selection contract.
 *
 * A single non-terminal exercise is current. Multiple non-terminal rows are a
 * typed product-state conflict: recency must never silently bind Runtime and UI
 * to an arbitrary exercise. With no active exercise, the newest terminal row is
 * retained as the historical presentation context.
 */
export function resolveCurrentExercise(candidates: readonly CurrentExerciseCandidate[]): CurrentExerciseSelection {
  const valid = candidates.filter(candidate => candidate.state.exerciseSession.exerciseId === candidate.exerciseId);
  const active = valid
    .filter(candidate => ["READY", "RUNNING", "PAUSED"].includes(exerciseLifecycle(candidate.state)))
    .sort(newestFirst);
  if (active.length > 1) {
    return Object.freeze({
      status: "CONFLICT",
      code: "MULTIPLE_ACTIVE_EXERCISES",
      exerciseIds: Object.freeze(active.map(candidate => candidate.exerciseId)),
      candidates: Object.freeze(active),
    });
  }
  if (active[0]) return Object.freeze({ status: "SELECTED", candidate: active[0] });
  const terminal = [...valid].sort(newestFirst)[0];
  return terminal
    ? Object.freeze({ status: "SELECTED", candidate: terminal })
    : Object.freeze({ status: "NONE" });
}
