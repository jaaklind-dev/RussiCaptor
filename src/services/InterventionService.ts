import type { InterventionType } from "@/models/Intervention";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { addIntervention } from "@/repositories/InterventionRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export const interventionLabels: Record<InterventionType, string> = {
  cpr: "CPR",
  airway: "Hingamistee tagamine",
  defibrillation: "Defibrilleerimine",
  iv_access: "Veenitee rajamine",
};

export function recordIntervention(
  patientId: string,
  type: InterventionType
): boolean {
  const patient = findPatientById(patientId);

  if (
    !patient ||
    patient.status === "Completed" ||
    !canCurrentCaseManagerEditPatient(patientId)
  ) {
    return false;
  }

  const exerciseId = getCurrentExercise().id;
  const caseManager = getCurrentCaseManager();
  const performedAt = new Date().toISOString();
  const label = interventionLabels[type];

  addIntervention({
    id: createId("INT"),
    exerciseId,
    patientId,
    type,
    label,
    status: "completed",
    performedBy: caseManager.name,
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
    visibility: "revealed",
  });

  notifySync();
  return true;
}
