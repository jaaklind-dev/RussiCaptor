export const TRANEXAMIC_ACID_FEATURE_ID = "TRANEXAMIC_ACID" as const;
export const TRANEXAMIC_ACID_DOSE_UNIT = "MG" as const;
export const TRANEXAMIC_ACID_REGIMEN_VERSION = "TXA_TRAUMA_REGIMEN_V1" as const;

export type TranexamicAcidLifecycle = "LOADING" | "MAINTENANCE" | "COMPLETED" | "STOPPED";
export type TranexamicAcidPhaseStatus = "NOT_STARTED" | "RUNNING" | "COMPLETED" | "STOPPED";
export type TranexamicAcidTimingClassification =
  | "WITHIN_WINDOW"
  | "LATE"
  | "TRAUMA_WINDOW_CLASSIFICATION_DEFERRED_NO_AUTHORITATIVE_INJURY_TIME";

export type TranexamicAcidConfiguration = Readonly<{
  schemaVersion: 1;
  regimenVersion: typeof TRANEXAMIC_ACID_REGIMEN_VERSION;
  loadingDoseMg: number;
  loadingDurationSec: number;
  maintenanceDoseMg: number;
  maintenanceDurationSec: number;
  eligibleTraumaWindowSec: number;
  effectHalfLifeSec: number;
}>;

export type TranexamicAcidRegimenState = Readonly<{
  schemaVersion: 1;
  featureId: typeof TRANEXAMIC_ACID_FEATURE_ID;
  regimenId: string;
  patientId: string;
  route: "IV" | "IO";
  vascularAccessId: string;
  lifecycle: TranexamicAcidLifecycle;
  regimenVersion: typeof TRANEXAMIC_ACID_REGIMEN_VERSION;
  loadingStatus: TranexamicAcidPhaseStatus;
  maintenanceStatus: TranexamicAcidPhaseStatus;
  loadingDeliveredMg: number;
  maintenanceDeliveredMg: number;
  startedAtSimulationTimeSec: number;
  phaseTransitionAtSimulationTimeSec: number;
  timingClassification: TranexamicAcidTimingClassification;
  authoritativeInjuryOnsetSimulationTimeSec?: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
  terminalEffectAnchor?: number;
}>;

export type TranexamicAcidCommand = Readonly<{
  commandId: string;
  action: "START" | "STOP";
  regimenId: string;
  patientId: string;
  simulationTimeSec: number;
  vascularAccessId?: string;
}>;

export type TranexamicAcidRejectionReason =
  | "INVALID_COMMAND"
  | "MISSING_VASCULAR_ACCESS"
  | "INVALID_PATIENT"
  | "ALREADY_ACTIVE"
  | "REGIMEN_NOT_FOUND"
  | "INVALID_STATE"
  | "STALE_SIMULATION_TIME";

export type TranexamicAcidCommandResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "NO_OP" | "REJECTED";
  commandId: string;
  state?: TranexamicAcidRegimenState;
  rejectionReason?: TranexamicAcidRejectionReason;
}>;

export type TranexamicAcidRuntimeEvent = Readonly<{
  eventType: "TranexamicAcidLoadingStarted" | "TranexamicAcidMaintenanceStarted" |
    "TranexamicAcidRegimenCompleted" | "TranexamicAcidRegimenStopped" | "TranexamicAcidCommandRejected";
  commandId?: string;
  regimenId: string;
  patientId: string;
  timestamp: number;
  lifecycle: TranexamicAcidLifecycle;
  loadingDeliveredMg: number;
  maintenanceDeliveredMg: number;
  reasonCode?: TranexamicAcidRejectionReason;
}>;

export type TranexamicAcidRuntimeSnapshot = Readonly<{
  schemaVersion: 1;
  configuration: TranexamicAcidConfiguration;
  regimens: readonly TranexamicAcidRegimenState[];
  commandResults: readonly TranexamicAcidCommandResult[];
  events: readonly TranexamicAcidRuntimeEvent[];
}>;

export type TranexamicAcidFeatureProjection = Readonly<{
  featureId: typeof TRANEXAMIC_ACID_FEATURE_ID;
  regimenId: string;
  patientId: string;
  category: "ANTIFIBRINOLYTIC";
  route: "IV" | "IO";
  vascularAccessId: string;
  lifecycle: TranexamicAcidLifecycle;
  loadingStatus: TranexamicAcidPhaseStatus;
  maintenanceStatus: TranexamicAcidPhaseStatus;
  loadingDeliveredMg: number;
  maintenanceDeliveredMg: number;
  startedAtSimulationTimeSec: number;
  phaseTransitionAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
  timingClassification: TranexamicAcidTimingClassification;
  currentAntifibrinolyticEffect: number;
}>;
