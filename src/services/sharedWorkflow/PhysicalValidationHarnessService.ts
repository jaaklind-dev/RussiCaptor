import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { addPatientNote } from "@/services/NoteService";
import { notifySync, runWithoutSyncNotifications } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { capturePatientSharedWorkflowState, restorePatientSharedWorkflowState, type PatientSharedWorkflowState } from "./PatientSharedWorkflowState";
import { getSharedWorkflowHead, sharedWorkflowStatusMessage, submitSharedWorkflowMutation, type SharedWorkflowMutationKind, type SharedWorkflowMutationResult } from "./SharedWorkflowMutationService";

/**
 * This service stages normal client proposals before sending them through the
 * unchanged authoritative mutation RPC. It is used only by the build-gated
 * physical validation card; it neither changes ownership nor bypasses CAS.
 */
export type PreparedPhysicalValidationMutation = Readonly<{
  patientId: string;
  commandId: string;
  kind: SharedWorkflowMutationKind;
  expectedRevision: number;
  expectedOwnerUserId?: string;
  state: PatientSharedWorkflowState;
}>;

export type PhysicalValidationOutcome = Readonly<{
  result: SharedWorkflowMutationResult;
  message: string;
}>;

function prepare(patientId: string, kind: SharedWorkflowMutationKind, label: string): PreparedPhysicalValidationMutation | undefined {
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const head = getSharedWorkflowHead(exerciseId, patientId);
  const before = capturePatientSharedWorkflowState(patientId);
  let changed = false;
  let proposed: PatientSharedWorkflowState;
  try {
    changed = runWithoutSyncNotifications(() => addPatientNote(patientId, label));
    proposed = capturePatientSharedWorkflowState(patientId);
  } finally {
    restorePatientSharedWorkflowState(patientId, before);
  }
  if (!changed) return undefined;
  return Object.freeze({
    patientId,
    commandId: createId(`SW-VALIDATION-${kind}`),
    kind,
    expectedRevision: head.revision,
    expectedOwnerUserId: head.ownerUserId,
    state: proposed!,
  });
}

export function prepareStaleFormerOwnerMutation(patientId: string): PreparedPhysicalValidationMutation | undefined {
  return prepare(patientId, "MUTABLE", "VALIDATION_STALE_FORMER_OWNER");
}

export function prepareSameBaseMutableMutation(patientId: string): PreparedPhysicalValidationMutation | undefined {
  return prepare(patientId, "MUTABLE", "VALIDATION_SAME_BASE_MUTABLE");
}

export async function submitPreparedPhysicalValidationMutation(
  prepared: PreparedPhysicalValidationMutation,
): Promise<PhysicalValidationOutcome> {
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const result = await submitSharedWorkflowMutation({
    exerciseId,
    patientId: prepared.patientId,
    commandId: prepared.commandId,
    kind: prepared.kind,
    expectedRevision: prepared.expectedRevision,
    expectedOwnerUserId: prepared.expectedOwnerUserId,
    nextOwnerUserId: prepared.expectedOwnerUserId,
    state: prepared.state,
  });
  if (result.state) {
    restorePatientSharedWorkflowState(prepared.patientId, result.state as PatientSharedWorkflowState);
    notifySync(result.status === "APPLIED" || result.status === "IDEMPOTENT" ? "device" : "remote");
  }
  return Object.freeze({ result, message: sharedWorkflowStatusMessage(result.status) });
}
