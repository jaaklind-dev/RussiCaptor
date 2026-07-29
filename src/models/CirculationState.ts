export type VascularAccessType = "PERIPHERAL_IV" | "IO" | "CENTRAL_ACCESS";
export type HemorrhageControlType = "DIRECT_PRESSURE" | "TOURNIQUET" | "PELVIC_BINDER";

export type ActiveVascularAccess = {
  interventionInstanceId: string;
  type: VascularAccessType;
  resourceIds: string[];
  location?: string;
  establishedAt: number;
};

export type CirculationState = {
  patientId: string;
  vascularAccess: ActiveVascularAccess[];
  hemorrhageControl: HemorrhageControlType[];
  runningInfusions: string[];
  updatedAt: number;
};

export type CirculationEventType =
  | "VascularAccessEstablished" | "VascularAccessRemoved"
  | "InfusionStarted" | "InfusionStopped"
  | "TourniquetApplied" | "TourniquetRemoved"
  | "PelvicBinderApplied" | "PelvicBinderRemoved";

export type CirculationRuntimeEvent = {
  eventType: CirculationEventType;
  timestamp: number;
  patientId: string;
  interventionInstanceId: string;
  definitionId: string;
};
