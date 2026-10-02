import { dataProvider } from "@/providers/ProviderFactory";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { addTimelineEvent, getAllTimelineEvents } from "@/repositories/TimelineRepository";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { notifySync } from "@/services/SyncService";
import { runtimePatientCommandSubmissionReadiness, submitPatientRuntimeCommand,
  waitForPatientRuntimeCommandResult } from "@/services/runtime/commands/RuntimePatientCommandService";
import { reconcilePatientTransportLocation } from "./PatientTransportRuntimeService";
import { getPackageOwnedLocationTransitions } from "@/services/exercise/PackagePatientLocationAuthorityService";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";
import { getSharedWorkflowHead, observeSharedWorkflowHead, type SharedWorkflowMutationStatus } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";

let sequence = 0;
const evidenceId = (commandId: string) => `TL-INTERNAL-TRANSFER-${commandId}`;

export function getAvailablePatientInternalTransfers(exerciseId: string, patientId: string) {
  const patient = dataProvider.getPatientById(patientId);
  if (!patient) return [];
  return getPackageOwnedLocationTransitions(exerciseId, patientId, patient.location);
}

/** Authoritative-writer materialization. Clients must use submitPatientInternalTransfer. */
export function materializePatientInternalTransfer(commandId: string, patientId: string, actionId: string,
  simulationTimeSec: number, actorUserId: string) {
  const exercise = getCanonicalExerciseSnapshot();
  const definition = getExercisePackage(exercise.exerciseId).internalTransferConfiguration?.definitions
    .find(item => item.actionId === actionId && item.patientId === patientId);
  if (!definition) return Object.freeze({ ok: false, reason: "INTERNAL_TRANSFER_NOT_ALLOWED" });
  const patient = dataProvider.getPatientById(patientId);
  if (!patient) return Object.freeze({ ok: false, reason: "PATIENT_NOT_FOUND" });
  const priorEvidence = getAllTimelineEvents().find(item => item.id === evidenceId(commandId));
  if (priorEvidence && patient.location === definition.toLocationId) {
    return Object.freeze({ ok: true, status: "IDEMPOTENT", actionId, locationId: patient.location });
  }
  if (patient.location !== definition.fromLocationId) {
    return Object.freeze({ ok: false, reason: patient.location === definition.toLocationId
      ? "INTERNAL_TRANSFER_ALREADY_COMPLETED" : "INVALID_TRANSFER_ORIGIN" });
  }
  if (!reconcilePatientTransportLocation(patientId, definition.toLocationId)) {
    return Object.freeze({ ok: false, reason: "ACTIVE_VEHICLE_TRANSPORT" });
  }
  dataProvider.setPatientLocation(patientId, definition.toLocationId);
  addTimelineEvent({ id: evidenceId(commandId), exerciseId: exercise.exerciseId, patientId,
    timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "transfer",
    title: actionId, description: `${definition.fromLocationId} → ${definition.toLocationId}`,
    author: "Internal Transfer Runtime", authorId: actorUserId, visibility: "revealed" });
  notifySync("local");
  return Object.freeze({ ok: true, status: "TRANSFERRED", actionId, locationId: definition.toLocationId });
}

const workflowReflectionCommandId = (commandId: string) => `${commandId}:WORKFLOW_REFLECTION`;

/** Materializes the accepted durable transfer through the patient head as one
 * authoritative proposal. A crash after the head commit is replay-safe via
 * the deterministic derived command ID; a failed head commit restores the
 * pre-transfer local state and therefore cannot mint a checkpoint ahead of
 * the shared projection. */
export async function materializePatientInternalTransferAuthoritatively(input: Readonly<{
  commandId: string;
  exerciseId: string;
  patientId: string;
  actionId: string;
  simulationTimeSec: number;
  actorUserId: string;
  acceptedPatientRevision: number;
}>) {
  const acceptedHead = getSharedWorkflowHead(input.exerciseId, input.patientId);
  if (acceptedHead.revision < input.acceptedPatientRevision) {
    observeSharedWorkflowHead(input.exerciseId, input.patientId, input.acceptedPatientRevision,
      acceptedHead.ownerUserId);
  }
  let ownershipStatus: SharedWorkflowMutationStatus = "UNAVAILABLE";
  try {
    const outcome = await executeAuthoritativePatientMutation({
      patientId: input.patientId,
      commandId: workflowReflectionCommandId(input.commandId),
      kind: "MUTABLE",
      mutate: () => materializePatientInternalTransfer(input.commandId, input.patientId, input.actionId,
        input.simulationTimeSec, input.actorUserId),
    });
    ownershipStatus = outcome.result.status;
    const result = outcome.value;
    const canonicalPatient = dataProvider.getPatientById(input.patientId);
    const canonicalEvidence = getAllTimelineEvents().filter(item => item.id === evidenceId(input.commandId));
    if ((ownershipStatus === "APPLIED" || ownershipStatus === "IDEMPOTENT") && result?.ok &&
        canonicalPatient?.location === result.locationId && canonicalEvidence.length === 1) {
      return Object.freeze({ ...result, ownershipStatus });
    }
  } catch {
    ownershipStatus = "UNAVAILABLE";
  }
  return Object.freeze({ ok: false, reason: "CANONICAL_WORKFLOW_REFLECTION_FAILED", ownershipStatus });
}

export async function submitPatientInternalTransfer(commandId: string, patientId: string, actionId: string) {
  const exercise = getCanonicalExerciseSnapshot();
  const readiness = runtimePatientCommandSubmissionReadiness(exercise.exerciseId, exercise.simulationTimeSec);
  if (!readiness.ready) return Object.freeze({ status: "REJECTED" as const, commandId,
    reason: readiness.reason ?? "COMMAND_NOT_READY" });
  const result = await submitPatientRuntimeCommand({ exerciseId: exercise.exerciseId, patientId, commandId,
    commandType: "PATIENT_LOCATION_TRANSFER", simulationTimeSec: exercise.simulationTimeSec,
    payload: Object.freeze({ actionId }) });
  if (result.status !== "APPLIED" && result.status !== "IDEMPOTENT") {
    return Object.freeze({ status: "REJECTED" as const, commandId, reason: result.status });
  }
  if (result.commandSequence !== undefined) {
    const materialized = await waitForPatientRuntimeCommandResult(exercise.exerciseId, result.commandSequence);
    if (materialized?.status === "REJECTED") return Object.freeze({ status: "REJECTED" as const, commandId,
      reason: typeof materialized.result.reason === "string" ? materialized.result.reason : "RUNTIME_MATERIALIZATION_FAILURE" });
  }
  return Object.freeze({ status: "PENDING" as const, commandId });
}

export function createPatientInternalTransferCommandId(exerciseId: string, patientId: string, actionId: string) {
  return `PATIENT_LOCATION_TRANSFER:${exerciseId}:${patientId}:${actionId}:${++sequence}`;
}
