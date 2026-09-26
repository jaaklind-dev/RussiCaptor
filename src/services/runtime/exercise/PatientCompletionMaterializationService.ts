import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById, setPatientStatus } from "@/repositories/PatientRepository";
import { cancelPendingScenarioEvents } from "@/repositories/ScenarioRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { unassignPatient } from "@/services/AssignmentRepository";
import { notifySync } from "@/services/SyncService";

export type PatientCompletionMaterializationResult = Readonly<{
  ok: boolean;
  status: "COMPLETED" | "IDEMPOTENT" | "REJECTED";
  reason?: "PATIENT_NOT_FOUND";
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
