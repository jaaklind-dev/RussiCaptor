import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById, setPatientStatus } from "@/repositories/PatientRepository";
import { cancelPendingScenarioEvents } from "@/repositories/ScenarioRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { unassignPatient } from "@/services/AssignmentRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

export function finishPatient(patientId: string): boolean {
  const patient = findPatientById(patientId);

  if (!patient || patient.status === "Completed") {
    return false;
  }

  cancelPendingScenarioEvents(
    patientId,
    getExerciseSession().currentMinute
  );
  setPatientStatus(patientId, "Completed");
  unassignPatient(patientId);

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "status",
    title: "Patsiendi käsitlus lõpetatud",
    description: "EXCON märkis patsiendi käsitluse lõpetatuks.",
    author: "EXCON",
    visibility: "revealed",
  });

  notifySync();
  return true;
}
