import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  addMedicationAdministration,
  getMedicationOption,
} from "@/repositories/MedicationRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";

export function administerMedication(
  patientId: string,
  optionId: string
): boolean {
  const patient = findPatientById(patientId);
  const option = getMedicationOption(patientId, optionId);

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
  const administeredAt = new Date().toISOString();

  addMedicationAdministration({
    id: createId("MED"),
    exerciseId,
    patientId,
    medicationOptionId: option.id,
    name: option.name,
    dose: option.dose,
    route: option.route,
    administeredBy: caseManager.name,
    administeredById: caseManager.id,
    administeredAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId,
    patientId,
    timestamp: administeredAt,
    type: "medication",
    title: option.name,
    description: `${option.name} ${option.dose} ${option.route} manustatud.`,
    author: caseManager.name,
    authorId: caseManager.id,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function administerMedicationConflictSafe(patientId:string,optionId:string){
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-MED"),kind:"APPEND",mutate:()=>administerMedication(patientId,optionId)});
}
