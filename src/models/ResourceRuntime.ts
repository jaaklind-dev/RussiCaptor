export type ResourceType =
  | "oxygen"
  | "oxygenMask"
  | "BVM"
  | "ventilator"
  | "endotrachealTube"
  | "monitor";

export type ResourceStatus = "AVAILABLE" | "RESERVED";

export type RuntimeResource = {
  resourceId: string;
  type: ResourceType;
  status: ResourceStatus;
  assignedPatientId?: string;
  exclusiveGroup?: string;
  metadata: Record<string, unknown>;
};

export type InterventionAction = "APPLY" | "REMOVE";

export type RuntimeIntervention = {
  interventionId: string;
  patientId: string;
  resourceId: string;
  action: InterventionAction;
  timestamp: number;
  priority: number;
  sourceProcessId?: string;
};

export type SchedulableIntervention = Omit<RuntimeIntervention, "priority"> & { priority?: number };

export type InterventionRejectionReason =
  | "LOWER_PRIORITY"
  | "DUPLICATE_ACTION"
  | "RESOURCE_ALREADY_RESERVED"
  | "EXCLUSIVE_GROUP_CONFLICT"
  | "INVALID_REMOVE"
  | "STALE_INTERVENTION";

export type ResourceEventType =
  | "ResourceReserved"
  | "ResourceReleased"
  | "InterventionApplied"
  | "InterventionRemoved"
  | "InterventionRejected";

export type ResourceRuntimeEvent = {
  eventType: ResourceEventType;
  timestamp: number;
  resourceId: string;
  patientId: string;
  interventionId?: string;
  sourceProcessId?: string;
  reasonCode?: InterventionRejectionReason;
  conflictingInterventionId?: string;
  exclusiveGroup?: string;
};
