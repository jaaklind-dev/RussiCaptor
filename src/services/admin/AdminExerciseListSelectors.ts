import type { AdminExercise } from "./PlatformAdminService";

export type AdminExerciseListView = "CURRENT" | "FINISHED";

// These are the existing terminal states, not an external archival status.
export function isFinishedAdminExercise(exercise: AdminExercise): boolean {
  return ["COMPLETED", "CANCELLED", "TERMINATED"].includes(exercise.lifecycleState);
}

export function filterAdminExercises(
  exercises: readonly AdminExercise[], view: AdminExerciseListView,
): readonly AdminExercise[] {
  // Unknown states stay visible in CURRENT; never hide an unrecognized lifecycle.
  return exercises.filter(exercise => isFinishedAdminExercise(exercise) === (view === "FINISHED"));
}
