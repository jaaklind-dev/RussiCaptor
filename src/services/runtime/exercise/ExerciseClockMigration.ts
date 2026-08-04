import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { validateExerciseClock } from "./ExerciseClockIntegrityValidator";

/** Informational only. Historical snapshots are returned unchanged. */
export function inspectClockMigration(snapshot: CanonicalExerciseSnapshot) {
  return validateExerciseClock(snapshot);
}

