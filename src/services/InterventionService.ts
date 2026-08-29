import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  addIntervention,
  getInterventionOption,
} from "@/repositories/InterventionRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export function recordIntervention(
  patientId: string,
  optionId: string
): boolean {
  const patient = findPatientById(patientId);
  const option = getInterventionOption(patientId, optionId);

  if (
    !patient ||
    !option ||
    patient.status === "Completed" ||
    !canCurrentCaseManagerEditPatient(patientId)
  ) {
    return false;
  }

  const exerciseId = getCurrentExercise().id;
  const caseManager = getCurrentCaseManager();
  const performedAt = new Date().toISOString();
  const label = option.label;

  addIntervention({
    id: createId("INT"),
    exerciseId,
    patientId,
    type: option.type,
    label,
    status: "completed",
    performedBy: caseManager.name,
    performedById: caseManager.id,
    performedAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId,
    patientId,
    timestamp: performedAt,
    type: "intervention",
    title: label,
    description: `${label} teostatud.`,
    author: caseManager.name,
    authorId: caseManager.id,
    visibility: "revealed",
  });

  notifySync();
  return true;
}
