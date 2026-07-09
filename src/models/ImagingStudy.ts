import { Visibility } from "@/models/Visibility";

export type ImagingStatus =
  | "processing"
  | "available"
  | "viewed";

export type ImagingModality =
  | "XR"
  | "CT"
  | "US"
  | "ECG"
  | "OTHER";

export type ImagingStudy = {
  id: string;
  exerciseId: string;
  patientId: string;

  modality: ImagingModality;
  title: string;
  report: string;
  attachment?: string;

  status: ImagingStatus;

imageVisibility: Visibility;
reportVisibility: Visibility;

releasedAt?: string;
};