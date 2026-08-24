import { createExerciseControlCommand } from "@/features/exercise/ExerciseControlCommandFactory";
import type { ExerciseControlCommand, ExerciseControlCommandType, ExerciseControlResult } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSpeed } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { handleExerciseControlCommand } from "./ExerciseControlCommandHandler";

type SubmissionDependencies = Readonly<{
  snapshot: typeof getCanonicalExerciseSnapshot;
  create: typeof createExerciseControlCommand;
  handle: typeof handleExerciseControlCommand;
}>;

const defaults: SubmissionDependencies = {
  snapshot: getCanonicalExerciseSnapshot,
  create: createExerciseControlCommand,
  handle: handleExerciseControlCommand,
};

/**
 * Prepares one immutable command per user intent. Native confirmation callbacks
 * may be delivered more than once on a busy device; replaying this closure then
 * reuses the commandId and reaches the command handler's idempotency cache.
 */
export function prepareExerciseControlSubmission(
  commandType: ExerciseControlCommandType,
  speed?: CanonicalExerciseSpeed,
  dependencies: SubmissionDependencies = defaults,
): () => ExerciseControlResult {
  const current = dependencies.snapshot();
  const command: ExerciseControlCommand = dependencies.create({
    exerciseId: current.exerciseId,
    commandType,
    expectedVersion: current.version,
    speed,
  });
  return () => dependencies.handle(command);
}
