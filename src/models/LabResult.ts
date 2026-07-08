import { Visibility } from "@/models/Visibility";

export type LabStatus =
  | "processing"
  | "available"
  | "viewed";

export type LabResult = {
  id: string;
  exerciseId: string;
  patientId: string;

  panel: string;
  name: string;
  value: string;
  unit: string;
  referenceRange: string;

  status: LabStatus;
  visibility: Visibility;

  releasedAt?: string;
};