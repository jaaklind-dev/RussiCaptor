import type { ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { InterventionResourceRequirement, ResourceAllocationRuntimeState } from "@/models/ResourceAllocation";
import type { InterventionInstance, InterventionInstanceStatus } from "@/models/InterventionInstance";

export type ResourceAwareInterventionDefinition = {
  readonly definitionId: string;
  readonly resourceRequirements: readonly InterventionResourceRequirement[];
};

export type ResourceAwareInterventionIntent = {
  readonly interventionId: string;
  readonly definitionId: string;
  readonly encounterId: string;
  readonly patientId: string;
  readonly requestedAtTick: number;
  readonly explicitPriority?: number;
  readonly patientPriority?: number;
  readonly parameters?: Record<string, ClinicalParameterValue>;
  readonly clinicalContext?: Record<string, boolean>;
};

export type ResourceAwareInterventionLifecycle = {
  readonly interventionId: string;
  readonly definitionId: string;
  readonly encounterId: string;
  readonly patientId: string;
  readonly requestedAtTick: number;
  readonly status: InterventionInstanceStatus;
  readonly allocationId?: string;
  readonly startedAtTick?: number;
  readonly endedAtTick?: number;
  readonly parameters: Record<string, ClinicalParameterValue>;
  readonly clinicalContext: Record<string, boolean>;
};

export type ResourceAwareInterventionSnapshot = {
  readonly allocationState: ResourceAllocationRuntimeState;
  readonly lifecycle: readonly ResourceAwareInterventionLifecycle[];
  readonly interventionInstances: readonly InterventionInstance[];
};
