import type { Note } from "@/models/Note";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getNotes(patientId: string): Note[] {
  return clinicalDataProvider.getNotes()
    .filter((note) => note.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addNote(note: Note): void {
  clinicalDataProvider.getNotes().push(note);
}

export function resetNotes(): void {
  clinicalDataProvider.resetNotes();
}
