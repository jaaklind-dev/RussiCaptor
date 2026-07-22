import type { VitalSigns } from "@/models/VitalSigns";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { addVitalSigns } from "@/repositories/VitalSignsRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export type VitalSignsInput = Omit<
  VitalSigns,
  "id" | "exerciseId" | "patientId" | "exerciseMinute" | "recordedAt" | "recordedBy" | "source"
>;

export function recordVitalSigns(
  patientId: string,
  values: VitalSignsInput
): boolean {
  if (!canCurrentCaseManagerEditPatient(patientId)) return false;

  const caseManager = getCurrentCaseManager();
  const timestamp = new Date().toISOString();
  const measurement: VitalSigns = {
    ...values,
    id: createId("VITAL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    exerciseMinute: getExerciseSession().currentMinute,
    recordedAt: timestamp,
    recordedBy: caseManager.name,
    source: "manual",
  };

  addVitalSigns(measurement);
  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp,
    type: "vitals",
    title: "Elulised näitajad mõõdetud",
    description: `HR ${values.heartRate ?? "–"}, RR ${values.respiratoryRate ?? "–"}, SpO₂ ${values.oxygenSaturation ?? "–"}%.`,
    author: caseManager.name,
    visibility: "revealed",
  });
  notifySync();
  return true;
}
