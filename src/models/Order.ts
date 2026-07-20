import { Visibility } from "@/models/Visibility";
import type { ScenarioAction } from "@/models/ScenarioEvent";

export type OrderCategory =
  | "lab"
  | "imaging"
  | "medication"
  | "consultation"
  | "blood";

export type OrderStatus =
  | "available"
  | "ordered"
  | "processing"
  | "completed";

export type OrderWorkflow = {
  resultAction: Extract<
    ScenarioAction,
    "lab.available" | "imaging.available"
  >;
  resultTargetId: string;
  delayMinutes: number;
  resultTitle: string;
  resultDescription: string;
};

export type Order = {
  id: string;

  exerciseId: string;
  patientId: string;

  category: OrderCategory;

  title: string;
  description?: string;

  status: OrderStatus;

  visibility: Visibility;

  workflow: OrderWorkflow;

  createdAt?: string;
  completedAt?: string;
};
