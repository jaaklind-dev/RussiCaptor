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
  metadata: Record<string, unknown>;
};

export type InterventionAction = "APPLY" | "REMOVE";

export type RuntimeIntervention = {
  interventionId: string;
  patientId: string;
  resourceId: string;
  action: InterventionAction;
  timestamp: number;
  sourceProcessId?: string;
};

export type ResourceEventType =
  | "ResourceReserved"
  | "ResourceReleased"
  | "InterventionApplied"
  | "InterventionRemoved";

export type ResourceRuntimeEvent = {
  eventType: ResourceEventType;
  timestamp: number;
  resourceId: string;
  patientId: string;
  interventionId?: string;
  sourceProcessId?: string;
};
