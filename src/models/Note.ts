export type Note = {
  id: string;
  exerciseId: string;
  patientId: string;
  text: string;
  author: string;
  /** Immutable authenticated operator id. Missing only on legacy rows. */
  authorId?: string;
  createdAt: string;
};
