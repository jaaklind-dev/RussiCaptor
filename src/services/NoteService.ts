import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { addNote as addNoteToRepository } from "@/repositories/NoteRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";

export function addPatientNote(patientId: string, text: string): boolean {
  const patient = findPatientById(patientId);
  const trimmedText = text.trim();

  if (
    !patient ||
    patient.status === "Completed" ||
    trimmedText.length === 0 ||
    !canCurrentCaseManagerEditPatient(patientId)
  ) {
    return false;
  }

  const exerciseId = getCurrentExercise().id;
  const createdAt = new Date().toISOString();

  const operator = getCurrentCaseManager();
  addNoteToRepository({
    id: createId("NOTE"),
    exerciseId,
    patientId,
    text: trimmedText,
    author: operator.name,
    authorId: operator.id,
    createdAt,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId,
    patientId,
    timestamp: createdAt,
    type: "note",
    title: "CM märge lisatud",
    description: trimmedText,
    author: operator.name,
    authorId: operator.id,
    visibility: "revealed",
  });

  notifySync();
  return true;
}
