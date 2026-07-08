import { Visibility } from "@/models/Visibility";

export type Question = {
  id: string;
  patientId: string;
  exerciseId: string;

  category: string;

  prompt: string;

  answer: string;

  visibility: Visibility;

  order: number;
};