import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { setImagingVisibility } from "@/repositories/ImagingRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export function openImagingStudy(
  patientId: string,
  imagingId: string,
  title: string
): void {
  console.log("openImagingStudy", patientId, imagingId);

  setImagingVisibility(patientId, imagingId, "revealed");

  console.log("imaging visibility updated");

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "imaging",
    title: `${title} avatud`,
    description: `Avati pildiuuring "${title}".`,
    author: "CM",
    visibility: "revealed",
  });

  notifySync();
}