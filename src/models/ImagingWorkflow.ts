import type { ImagingModality } from "@/models/ImagingStudy";

export const IMAGING_WORKFLOW_SCHEMA_VERSION = 1 as const;
export type ImagingInstanceStatus = "ORDERED" | "PROCESSING" | "RESULTED";

export type ImagingReleasedResult = Readonly<{
  report: string;
  attachment?: string;
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
  repeatOrdinal: number;
  status: ImagingInstanceStatus;
  /** Package-authored source captured at order time; it is not a released clinical result. */
  authoredSource: Readonly<{ report: string; attachment?: string }>;
  result?: ImagingReleasedResult;
}>;

export type ImagingWorkflowSnapshot = Readonly<{
  schemaVersion: typeof IMAGING_WORKFLOW_SCHEMA_VERSION;
  instances: readonly ImagingStudyInstance[];
  terminalFencedAtSimulationTimeSec?: number;
}>;

export type ImagingOrderDefinitionSnapshot = Readonly<{
  definitionId: string;
  patientId: string;
  title: string;
  modality: ImagingModality;
  reportSource: string;
  attachment?: string;
  delaySeconds: number;
  packageId: string;
  packageVersion: string;
  packageHash: string;
}>;
