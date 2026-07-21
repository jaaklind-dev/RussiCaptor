import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById, setPatientLocation } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { getCurrentLocationZone } from "@/services/CurrentLocationService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export function updatePatientLocationFromCurrentCm(patientId: string): boolean {
  const patient = findPatientById(patientId);
  const zone = getCurrentLocationZone();

  if (!patient || !zone || patient.location === zone.name) {
    return false;
  }

  const timestamp = new Date().toISOString();
  const previousLocation = patient.location;
  setPatientLocation(patientId, zone.name);

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp,
    type: "status",
    title: "Patsiendi asukoht muutus",
    description: `${previousLocation} → ${zone.name}`,
    author: getCurrentCaseManager().name,
    visibility: "revealed",
  });

  notifySync();
  return true;
}
