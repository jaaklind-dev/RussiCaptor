import { notes } from "@/data/notes";
import type { Note } from "@/models/Note";

export function getNotes(patientId: string): Note[] {
  return notes
    .filter((note) => note.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addNote(note: Note): void {
  notes.push(note);
}

export function resetNotes(): void {
  notes.splice(0, notes.length);
}
