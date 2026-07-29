export const clinicalResourceTypes = [
  "BVM", "OXYGEN_SOURCE", "OXYGEN_DELIVERY_DEVICE", "AIRWAY_EQUIPMENT",
  "SUPRAGLOTTIC_AIRWAY", "ENDOTRACHEAL_TUBE", "MECHANICAL_VENTILATOR",
  "SUCTION_DEVICE", "IV_ACCESS_KIT", "INFUSION_PUMP", "MONITOR", "CLINICIAN", "NURSE",
] as const;

export type ClinicalResourceType = typeof clinicalResourceTypes[number];
export type ResourceAllocationMode = "EXCLUSIVE" | "CAPACITY";
export type ResourceReleaseMode = "EXPLICIT" | "ON_INTERVENTION_END" | "TIMED";
export type ResourceRequirementPhase = "START" | "DURATION" | "COMPLETION";

export type ClinicalResourceDefinition = {
  readonly resourceType: ClinicalResourceType;
  readonly capacity: number;
  readonly allocationMode: ResourceAllocationMode;
  readonly releaseMode: ResourceReleaseMode;
  readonly defaultAllocationDurationTicks?: number;
};

export type InterventionResourceRequirement = {
  readonly resourceType: ClinicalResourceType;
  readonly quantity: number;
  readonly requiredFor: ResourceRequirementPhase;
  readonly optional?: boolean;
};

export type AllocatedResource = {
  readonly resourceType: ClinicalResourceType;
  readonly quantity: number;
};

export type ResourceAllocationStatus = "ACTIVE" | "RELEASED" | "CANCELLED" | "EXPIRED";
export type ResourceRequestStatus = "WAITING" | "ALLOCATED" | "CANCELLED" | "REJECTED";

export type ResourceAllocation = {
  readonly allocationId: string;
  readonly requestId: string;
  readonly interventionId: string;
  readonly patientId: string;
  readonly resources: readonly AllocatedResource[];
  readonly createdAtTick: number;
  readonly effectiveAtTick: number;
  readonly expiresAtTick?: number;
  readonly status: ResourceAllocationStatus;
  readonly releasedAtTick?: number;
};

export type ResourceAllocationRequest = {
  readonly requestId: string;
  readonly interventionId: string;
  readonly patientId: string;
  readonly requirements: readonly InterventionResourceRequirement[];
  readonly requestedAtTick: number;
  readonly explicitPriority: number;
  readonly patientPriority: number;
  readonly effectivePriority: number;
  readonly status: ResourceRequestStatus;
  readonly allocationId?: string;
};

export type ResourceAvailability = {
  readonly resourceType: ClinicalResourceType;
  readonly total: number;
  readonly allocated: number;
  readonly available: number;
  readonly waitingRequestCount: number;
  readonly activePatientIds: readonly string[];
};

export type ResourceAllocationFailureReason =
  | "RESOURCE_UNAVAILABLE" | "INSUFFICIENT_CAPACITY" | "INVALID_REQUIREMENT"
  | "UNKNOWN_RESOURCE_TYPE" | "REQUEST_CANCELLED" | "INTERVENTION_NOT_FOUND"
  | "ALREADY_ALLOCATED" | "ALLOCATION_NOT_FOUND" | "INVALID_CONFIGURATION";

export type ResourceAllocationEventType =
  | "ResourceAllocationRequested" | "ResourceAllocationSucceeded" | "ResourceAllocationDeferred"
  | "ResourceAllocationReleased" | "ResourceAllocationCancelled" | "ResourceAllocationExpired"
  | "ResourceQueuePriorityChanged" | "InterventionWaitingForResources"
  | "InterventionStartedAfterResourceAllocation";

export type ResourceAllocationEvent = {
  readonly eventType: ResourceAllocationEventType;
  readonly sequence: number;
  readonly tick: number;
  readonly requestId: string;
  readonly interventionId: string;
  readonly patientId: string;
  readonly allocationId?: string;
  readonly resources: readonly AllocatedResource[];
  readonly requestedAtTick: number;
  readonly allocationTick?: number;
  readonly releaseTick?: number;
  readonly reason?: ResourceAllocationFailureReason | "EXPLICIT" | "COMPLETED" | "CANCELLED" | "TIMED";
};

export type ResourceAllocationConfiguration = {
  readonly version: string;
  readonly resources: readonly ClinicalResourceDefinition[];
  readonly fairness: { readonly ageingIntervalTicks: number; readonly ageingPriorityStep: number };
};

export type ResourceAllocationRuntimeState = {
  readonly configuration: ResourceAllocationConfiguration;
  readonly allocations: readonly ResourceAllocation[];
  readonly requests: readonly ResourceAllocationRequest[];
  readonly sequence: number;
  readonly currentTick: number;
  readonly events: readonly ResourceAllocationEvent[];
};

export type ResourceAllocationIntent = {
  readonly interventionId: string;
  readonly patientId: string;
  readonly requirements: readonly InterventionResourceRequirement[];
  readonly requestedAtTick: number;
  readonly explicitPriority?: number;
  readonly patientPriority?: number;
};
