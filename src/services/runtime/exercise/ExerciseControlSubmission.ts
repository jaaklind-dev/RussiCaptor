import { createExerciseControlCommand } from "@/features/exercise/ExerciseControlCommandFactory";
import type { ExerciseControlCommand, ExerciseControlCommandType, ExerciseControlResult } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSpeed } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { handleExerciseControlCommand } from "./ExerciseControlCommandHandler";
import { traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { submitRuntimeCompletion } from "./RuntimeCompletionService";

type SubmissionDependencies = Readonly<{
  snapshot: typeof getCanonicalExerciseSnapshot;
  create: typeof createExerciseControlCommand;
  handle: typeof handleExerciseControlCommand;
  submitCompletion?: typeof submitRuntimeCompletion;
}>;

const defaults: SubmissionDependencies = {
  snapshot: getCanonicalExerciseSnapshot,
  create: createExerciseControlCommand,
  handle: handleExerciseControlCommand,
  submitCompletion: submitRuntimeCompletion,
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
): () => ExerciseControlResult | Promise<ExerciseControlResult> {
  const current = dependencies.snapshot();
  const command: ExerciseControlCommand = dependencies.create({
    exerciseId: current.exerciseId,
    commandType,
    expectedVersion: current.version,
    speed,
  });
  return () => {
    if (command.commandType === "COMPLETE_EXERCISE") traceRuntimeLeaseLifecycle("COMPLETE_COMMAND_START", { detail: {} });
    if (command.commandType === "COMPLETE_EXERCISE" && dependencies.submitCompletion) {
      return dependencies.submitCompletion(command).then(result => {
        traceRuntimeLeaseLifecycle("COMPLETE_COMMAND_RESULT", { detail: { ok: result.ok, errorCode: result.ok ? undefined : result.errorCode } });
        return result;
      });
    }
    const result = dependencies.handle(command);
    if (command.commandType === "COMPLETE_EXERCISE") traceRuntimeLeaseLifecycle("COMPLETE_COMMAND_RESULT", { detail: { ok: result.ok, errorCode: result.ok ? undefined : result.errorCode } });
    return result;
  };
}
