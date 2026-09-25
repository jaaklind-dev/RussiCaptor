import { Visibility } from "@/models/Visibility";
import type { ImagingAssetReference } from "@/models/ImagingAsset";

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
  asset?: ImagingAssetReference;
  /** Import-only compatibility. Canonical package/runtime content uses asset. */
  attachment?: string;

  status: ImagingStatus;

imageVisibility: Visibility;
reportVisibility: Visibility;

releasedAt?: string;
};
