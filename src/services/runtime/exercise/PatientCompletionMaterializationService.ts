import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById, setPatientStatus } from "@/repositories/PatientRepository";
import { cancelPendingScenarioEvents, getPendingScenarioEvents } from "@/repositories/ScenarioRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getPatientAssignment, unassignPatient } from "@/services/AssignmentRepository";
import { notifySync } from "@/services/SyncService";
import { executeAuthoritativePatientMutation } from
  "@/services/sharedWorkflow/AuthoritativePatientMutationService";
import { getSharedWorkflowHead, observeSharedWorkflowHead, type SharedWorkflowMutationStatus } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";

export type PatientCompletionMaterializationResult = Readonly<{
  ok: boolean;
  status: "COMPLETED" | "IDEMPOTENT" | "REJECTED";
  reason?: "PATIENT_NOT_FOUND" | "CANONICAL_OWNERSHIP_RELEASE_FAILED";
  ownershipStatus?: SharedWorkflowMutationStatus;
}>;

/** Authoritative-writer helper. Production clients must submit PATIENT_COMPLETE. */
export function materializePatientCompletion(commandId: string, patientId: string,
  simulationTimeSec: number, actorUserId: string): PatientCompletionMaterializationResult {
  const patient = findPatientById(patientId);
  if (!patient) return Object.freeze({ ok: false, status: "REJECTED", reason: "PATIENT_NOT_FOUND" });
  if (patient.status === "Completed") return Object.freeze({ ok: true, status: "IDEMPOTENT" });

  cancelPendingScenarioEvents(patientId, simulationTimeSec / 60);
  setPatientStatus(patientId, "Completed");
  unassignPatient(patientId);
  addTimelineEvent({
    id: `TL-PATIENT-COMPLETE-${commandId}`, exerciseId: getCurrentExercise().id, patientId,
    timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "status",
    title: "Patsiendi käsitlus lõpetatud",
    description: "EXCON märkis patsiendi käsitluse lõpetatuks.", author: "EXCON",
    authorId: actorUserId, visibility: "revealed",
  });
  notifySync("local");
  return Object.freeze({ ok: true, status: "COMPLETED" });
}

const ownershipReleaseCommandId = (commandId: string): string =>
  `${commandId}:OWNERSHIP_RELEASE`;

/**
 * Completes a durable patient command through the canonical shared-workflow
 * RELEASE boundary. The accepted Runtime command has already advanced the
 * patient revision without changing its owner, so the writer first observes
 * that accepted revision and then atomically publishes Completed + unowned +
 * closed assignment state. A deterministic derived command ID makes a crash
 * between RELEASE and Runtime result recording safe to replay.
 */
export async function materializePatientCompletionAuthoritatively(input: Readonly<{
  commandId: string;
  exerciseId: string;
  patientId: string;
  simulationTimeSec: number;
  actorUserId: string;
  acceptedPatientRevision: number;
}>): Promise<PatientCompletionMaterializationResult> {
  const initialPatient = findPatientById(input.patientId);
  if (!initialPatient) return Object.freeze({ ok: false, status: "REJECTED", reason: "PATIENT_NOT_FOUND" });

  const acceptedHead = getSharedWorkflowHead(input.exerciseId, input.patientId);
  if (acceptedHead.revision < input.acceptedPatientRevision) {
    // Runtime command acceptance increments the same canonical patient head
    // and deliberately preserves its owner.
    observeSharedWorkflowHead(input.exerciseId, input.patientId,
      input.acceptedPatientRevision, acceptedHead.ownerUserId);
  }

  const alreadyCanonical = (): boolean => {
    const patient = findPatientById(input.patientId);
    const assignment = getPatientAssignment(input.patientId);
    const head = getSharedWorkflowHead(input.exerciseId, input.patientId);
    return patient?.status === "Completed" && head.ownerUserId === undefined &&
      (!assignment || Boolean(assignment.endedAt));
  };
  if (alreadyCanonical()) return Object.freeze({ ok: true, status: "IDEMPOTENT" });

  const completedBeforeRelease = initialPatient.status === "Completed";
  const pendingScenarioEventsBeforeRelease = getPendingScenarioEvents(input.patientId).map(event => ({
    event,
    cancelled: event.cancelled,
    resolvedAtMinute: event.resolvedAtMinute,
  }));
  let ownershipStatus: SharedWorkflowMutationStatus = "UNAVAILABLE";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const outcome = await executeAuthoritativePatientMutation({
        patientId: input.patientId,
        commandId: ownershipReleaseCommandId(input.commandId),
        kind: "RELEASE",
        mutate: () => {
          if (findPatientById(input.patientId)?.status === "Completed") {
            // Reconcile the physical failure shape: checkpoint completion was
            // durable, but its canonical owner/assignment release was not.
            unassignPatient(input.patientId);
            return Object.freeze({ ok: true, status: "IDEMPOTENT" as const });
          }
          return materializePatientCompletion(input.commandId, input.patientId,
            input.simulationTimeSec, input.actorUserId);
        },
      });
      ownershipStatus = outcome.result.status;
      if ((ownershipStatus === "APPLIED" || ownershipStatus === "IDEMPOTENT") && alreadyCanonical()) {
        return Object.freeze({ ok: true,
          status: completedBeforeRelease || ownershipStatus === "IDEMPOTENT" ? "IDEMPOTENT" : "COMPLETED",
          ownershipStatus });
      }
      if (ownershipStatus !== "STALE_VERSION" && ownershipStatus !== "OWNERSHIP_CHANGED") break;
    } catch {
      ownershipStatus = "UNAVAILABLE";
      break;
    }
  }
  // Scenario events live in the exercise checkpoint rather than the patient
  // shared-workflow projection, so restore their pre-proposal fields when the
  // canonical RELEASE did not commit.
  pendingScenarioEventsBeforeRelease.forEach(({ event, cancelled, resolvedAtMinute }) => {
    event.cancelled = cancelled;
    event.resolvedAtMinute = resolvedAtMinute;
  });
  return Object.freeze({ ok: false, status: "REJECTED",
    reason: "CANONICAL_OWNERSHIP_RELEASE_FAILED", ownershipStatus });
}
