import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  setImagingImageVisibility,
  setImagingReportVisibility,
} from "@/repositories/ImagingRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
export function openImagingImage(
  patientId: string,
  imagingId: string,
  title: string
): void {
  if (!canCurrentCaseManagerEditPatient(patientId)) {
    return;
  }

  setImagingImageVisibility(
    patientId,
    imagingId,
    "revealed"
  );

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "imaging",
    title: `${title} pilt avatud`,
    description: `Avati pildiuuringu "${title}" pilt.`,
    author: "CM",
    visibility: "revealed",
  });

  notifySync();
}

export function openImagingReport(
  patientId: string,
  imagingId: string,
  title: string
): void {
  if (!canCurrentCaseManagerEditPatient(patientId)) {
    return;
  }

  setImagingReportVisibility(
    patientId,
    imagingId,
    "revealed"
  );

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "imaging",
    title: `${title} raport avatud`,
    description: `Avati pildiuuringu "${title}" radioloogi raport.`,
    author: "CM",
    visibility: "revealed",
  });

  notifySync();
}
