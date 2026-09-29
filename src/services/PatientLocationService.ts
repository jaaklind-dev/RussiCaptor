import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById, setPatientLocation } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { getCurrentLocationZone } from "@/services/CurrentLocationService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";
import { getSharedWorkflowHead } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { hasPackageOwnedLocationAuthority } from "@/services/exercise/PackagePatientLocationAuthorityService";

export function updatePatientLocationFromCurrentCm(patientId: string): boolean {
  const patient = findPatientById(patientId);
  const zone = getCurrentLocationZone();

  if (!patient || !zone || patient.location === zone.name) {
    return false;
  }

  const timestamp = new Date().toISOString();
  const previousLocation = patient.location;
  const operator = getCurrentCaseManager();
  setPatientLocation(patientId, zone.name);

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp,
    type: "status",
    title: "Patsiendi asukoht muutus",
    description: `${previousLocation} → ${zone.name}`,
    author: operator.name,
    authorId: operator.id,
    visibility: "revealed",
  });

  notifySync();
  return true;
}

export function updatePatientLocationFromCurrentCmConflictSafe(patientId:string){
  const patient = findPatientById(patientId);
  const zone = getCurrentLocationZone();
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  if (patient && hasPackageOwnedLocationAuthority(exerciseId, patientId, patient.location)) {
    const head = getSharedWorkflowHead(exerciseId, patientId);
    return Promise.resolve(Object.freeze({
      result: Object.freeze({ status: "IDEMPOTENT" as const, revision: head.revision,
        ownerUserId: head.ownerUserId }),
      value: false,
      message: "Patsiendi asukohta juhib paketipõhine asukohatoiming.",
    }));
  }
  if (!patient || !zone || patient.location === zone.name) {
    const head = getSharedWorkflowHead(exerciseId, patientId);
    return Promise.resolve(Object.freeze({
      result: Object.freeze({ status: "IDEMPOTENT" as const, revision: head.revision,
        ownerUserId: head.ownerUserId }),
      value: false,
      message: "Patsiendi asukoht on juba ajakohane.",
    }));
  }
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-LOCATION"),kind:"MUTABLE",mutate:()=>updatePatientLocationFromCurrentCm(patientId)});
}
