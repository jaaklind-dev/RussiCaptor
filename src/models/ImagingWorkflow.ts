import type { ImagingModality } from "@/models/ImagingStudy";
import type { ImagingAssetReference } from "@/models/ImagingAsset";

export const IMAGING_WORKFLOW_SCHEMA_VERSION = 2 as const;
/** Opt-in extension; combined-release schema-2 checkpoints remain unchanged. */
export const IMAGING_STAGED_WORKFLOW_SCHEMA_VERSION = 3 as const;
export type ImagingInstanceStatus = "ORDERED" | "PROCESSING" | "RESULTED";

export type ImagingReleasedImage = Readonly<{
  imageResultId: string;
  imagingInstanceId: string;
  patientId: string;
  definitionId: string;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  asset: ImagingAssetReference;
  releasedAtSimulationTimeSec: number;
}>;

export type ImagingReleasedResult = Readonly<{
  resultId: string;
  imagingInstanceId: string;
  patientId: string;
  definitionId: string;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  reportText: string;
  authoredReportSha256: string;
  asset?: ImagingAssetReference;
  releasedAtSimulationTimeSec: number;
}>;

export type ImagingStudyInstance = Readonly<{
  imagingInstanceId: string;
  orderCommandId: string;
  exerciseId: string;
  patientId: string;
  definitionId: string;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  title: string;
  modality: ImagingModality;
  orderedBy: string;
  orderedAtSimulationTimeSec: number;
  processingStartedAtSimulationTimeSec?: number;
  availableAtSimulationTimeSec: number;
  /** Present only for explicitly staged image/report release. availableAt remains the report deadline. */
  imageAvailableAtSimulationTimeSec?: number;
  repeatOrdinal: number;
  status: ImagingInstanceStatus;
  /** Package-authored source captured at order time; it is not a released clinical result. */
  authoredSource: Readonly<{ reportText: string; reportSha256: string; asset?: ImagingAssetReference }>;
  imageResult?: ImagingReleasedImage;
  result?: ImagingReleasedResult;
}>;

export type ImagingWorkflowSnapshot = Readonly<{
  schemaVersion: typeof IMAGING_WORKFLOW_SCHEMA_VERSION | typeof IMAGING_STAGED_WORKFLOW_SCHEMA_VERSION;
  instances: readonly ImagingStudyInstance[];
  terminalFencedAtSimulationTimeSec?: number;
}>;

export type ImagingOrderDefinitionSnapshot = Readonly<{
  definitionId: string;
  patientId: string;
  title: string;
  modality: ImagingModality;
  reportSource: string;
  asset?: ImagingAssetReference;
  delaySeconds: number;
  /** Optional image deadline from order; requires an asset and cannot exceed delaySeconds. */
  imageDelaySeconds?: number;
  packageId: string;
  packageVersion: string;
  packageHash: string;
}>;
