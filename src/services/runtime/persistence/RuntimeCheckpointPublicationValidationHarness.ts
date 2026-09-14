import type { CheckpointPublishResult } from "@/models/RuntimeCheckpointAuthority";
import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

let armedExerciseId: string | undefined;

/** Arms one real publication response to be withheld after the server commits. */
export function armNextRuntimeCheckpointPublicationLostResponseForValidation(exerciseId: string): boolean {
  if (!isSharedWorkflowValidationHarnessEnabled() || !exerciseId.trim()) return false;
  armedExerciseId = exerciseId;
  traceRuntimeLeaseLifecycle("VALIDATION_PUBLICATION_LOST_RESPONSE_ARMED", { detail: {} });
  return true;
}

export function isRuntimeCheckpointPublicationLostResponseArmedForValidation(exerciseId: string): boolean {
  return isSharedWorkflowValidationHarnessEnabled() && armedExerciseId === exerciseId;
}

/** Test/cleanup support for validation state only; it never touches Runtime or remote state. */
export function clearRuntimeCheckpointPublicationLostResponseForValidation(): boolean {
  if (!isSharedWorkflowValidationHarnessEnabled()) return false;
  armedExerciseId = undefined;
  return true;
}

/**
 * Waits for the genuine repository result first. A successful commit consumes
 * the one-shot arm and deliberately leaves only the client response pending,
 * so the normal publication timeout and reconciliation path do all recovery.
 */
export async function interceptRuntimeCheckpointPublicationResponseForValidation<TPayload>(
  publication: Promise<CheckpointPublishResult<TPayload>>,
  exerciseId: string,
): Promise<CheckpointPublishResult<TPayload>> {
  const result = await publication;
  if (!isSharedWorkflowValidationHarnessEnabled()) {
    armedExerciseId = undefined;
    return result;
  }
  if (result.status !== "PUBLISHED" || result.checkpoint.exerciseId !== exerciseId || armedExerciseId !== exerciseId) {
    return result;
  }
  armedExerciseId = undefined;
  traceRuntimeLeaseLifecycle("VALIDATION_PUBLICATION_LOST_RESPONSE_FIRED", {
    detail: { checkpointRevision: result.checkpoint.checkpointRevision },
  });
  return new Promise<CheckpointPublishResult<TPayload>>(() => undefined);
}
