import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { CompletedExerciseArchive } from "@/services/exercise/CompletedExerciseArchiveService";

/** Active Runtime state never carries evidence archives from prior exercises. */
export function compactActiveExerciseState(
  state: SharedExerciseState,
): SharedExerciseState {
  const compact = structuredClone(state);
  delete compact.completedExerciseArchives;
  return compact;
}

/** A durable terminal exercise row owns exactly its own immutable archive. */
export function withTerminalExerciseArchive(
  state: SharedExerciseState,
  archive: CompletedExerciseArchive,
): SharedExerciseState {
  const compact = compactActiveExerciseState(state);
  const session = compact.exerciseSession;
  const lifecycle = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycle !== "COMPLETED") return compact;
  if (archive.exerciseId !== session.exerciseId) throw new Error("COMPLETED_ARCHIVE_EXERCISE_MISMATCH");
  return { ...compact, completedExerciseArchives: [structuredClone(archive)] };
}

export function archiveForExercise(
  archives: readonly CompletedExerciseArchive[] | undefined,
  exerciseId: string,
): CompletedExerciseArchive | undefined {
  const archive = archives?.find(item => item.exerciseId === exerciseId);
  return archive ? structuredClone(archive) : undefined;
}
