import type { ClinicalParameterValue } from "@/models/ClinicalIntegration";

export type InterventionInstanceStatus =
  | "REQUESTED" | "WAITING_FOR_RESOURCES" | "RESOURCES_ALLOCATED"
  | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";

export type InterventionFailureReason =
  | "DEFINITION_NOT_FOUND"
  | "INVALID_PARAMETERS"
  | "PRECONDITION_FAILED"
  | "REQUIRED_RESOURCE_MISSING";

export type InterventionInstance = {
  instanceId: string;
  definitionId: string;
  definitionVersion: string;
  definitionName: string;
  encounterId: string;
  patientId: string;
  status: InterventionInstanceStatus;
  startedAt: number;
  endedAt?: number;
  parameters: Record<string, ClinicalParameterValue>;
  resourceIds: string[];
  sourceInterventionId: string;
  failureReason?: InterventionFailureReason;
};
