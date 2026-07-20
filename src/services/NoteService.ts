import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { addNote as addNoteToRepository } from "@/repositories/NoteRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";

export function addPatientNote(patientId: string, text: string): boolean {
  const patient = findPatientById(patientId);
  const trimmedText = text.trim();

  if (!patient || patient.status === "Completed" || trimmedText.length === 0) {
    return false;
  }

  const exerciseId = getCurrentExercise().id;
  const createdAt = new Date().toISOString();

  addNoteToRepository({
    id: createId("NOTE"),
    exerciseId,
    patientId,
    text: trimmedText,
    author: "Jaak",
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
    author: "Jaak",
    visibility: "revealed",
  });

  notifySync();
  return true;
}
