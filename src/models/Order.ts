import { Visibility } from "@/models/Visibility";

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

export type Order = {
  id: string;

  exerciseId: string;
  patientId: string;

  category: OrderCategory;

  title: string;
  description?: string;

  status: OrderStatus;

  visibility: Visibility;

  createdAt?: string;
  completedAt?: string;
};