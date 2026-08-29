import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import {
  setImagingImageVisibility,
  setImagingReportVisibility,
} from "@/repositories/ImagingRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";
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
    author: getCurrentCaseManager().name,
    authorId: getCurrentCaseManager().id,
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
    author: getCurrentCaseManager().name,
    authorId: getCurrentCaseManager().id,
    visibility: "revealed",
  });

  notifySync();
}

export function openImagingImageConflictSafe(patientId:string,imagingId:string,title:string){
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-IMAGING"),kind:"MUTABLE",mutate:()=>openImagingImage(patientId,imagingId,title)});
}
export function openImagingReportConflictSafe(patientId:string,imagingId:string,title:string){
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-IMAGING"),kind:"MUTABLE",mutate:()=>openImagingReport(patientId,imagingId,title)});
}
