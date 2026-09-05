export const MECHANICAL_VENTILATION_FEATURE_ID = "MECHANICAL_VENTILATION" as const;
export const VOLUME_CONTROL_MODE = "VOLUME_CONTROL" as const;
export const VENTILATION_RATE_UNIT = "BREATHS_MIN" as const;
export const TIDAL_VOLUME_UNIT = "ML" as const;
export const PEEP_UNIT = "CM_H2O" as const;

export type MechanicalVentilationMode = typeof VOLUME_CONTROL_MODE;
export type MechanicalVentilationLifecycle = "RUNNING" | "STOPPED";
export type MechanicalVentilationStopReason = "COMMAND" | "AIRWAY_LOST";

export type MechanicalVentilationConfiguration = Readonly<{
  schemaVersion: 1;
  version: "MECHANICAL_VENTILATION_V1";
  minimumRespiratoryRate: number;
  maximumRespiratoryRate: number;
  minimumTidalVolumeMl: number;
  maximumTidalVolumeMl: number;
  minimumFio2: number;
  maximumFio2: number;
  minimumPeepCmH2O: number;
  maximumPeepCmH2O: number;
}>;

export type MechanicalVentilationSettings = Readonly<{
  mode: MechanicalVentilationMode;
  respiratoryRate: number;
  respiratoryRateUnit: typeof VENTILATION_RATE_UNIT;
  tidalVolumeMl: number;
  tidalVolumeUnit: typeof TIDAL_VOLUME_UNIT;
  fio2: number;
  peepCmH2O: number;
  peepUnit: typeof PEEP_UNIT;
}>;

export type MechanicalVentilationState = MechanicalVentilationSettings & Readonly<{
  schemaVersion: 1;
  featureId: typeof MECHANICAL_VENTILATION_FEATURE_ID;
  supportId: string;
  patientId: string;
  securedAirwayId: string;
  lifecycle: MechanicalVentilationLifecycle;
  startedAtSimulationTimeSec: number;
  lastSettingsChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  stopReason?: MechanicalVentilationStopReason;
}>;

export type MechanicalVentilationCommand = Readonly<{
  commandId: string;
  action: "START" | "CHANGE_SETTINGS" | "STOP";
  supportId: string;
  patientId: string;
  simulationTimeSec: number;
  securedAirwayId?: string;
  settings?: MechanicalVentilationSettings;
}>;

export type MechanicalVentilationRejectionReason =
  | "INVALID_COMMAND"
  | "INVALID_MODE"
  | "INVALID_RESPIRATORY_RATE"
  | "INVALID_TIDAL_VOLUME"
  | "INVALID_FIO2"
  | "INVALID_PEEP"
  | "INVALID_UNIT"
  | "MISSING_SECURED_AIRWAY"
  | "INVALID_PATIENT"
  | "SUPPORT_NOT_FOUND"
  | "ALREADY_ACTIVE"
  | "INVALID_STATE"
  | "STALE_SIMULATION_TIME";

export type MechanicalVentilationCommandResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "NO_OP" | "REJECTED";
  commandId: string;
  state?: MechanicalVentilationState;
  rejectionReason?: MechanicalVentilationRejectionReason;
}>;

export type MechanicalVentilationRuntimeEvent = Readonly<{
  eventType: "MechanicalVentilationStarted" | "MechanicalVentilationSettingsChanged" |
    "MechanicalVentilationStopped" | "MechanicalVentilationCommandRejected";
  commandId?: string;
  supportId: string;
  patientId: string;
  timestamp: number;
  lifecycle: MechanicalVentilationLifecycle;
  reasonCode?: MechanicalVentilationRejectionReason | MechanicalVentilationStopReason;
}>;

export type MechanicalVentilationFeatureProjection = Readonly<{
  featureId: typeof MECHANICAL_VENTILATION_FEATURE_ID;
  supportId: string;
  patientId: string;
  securedAirwayId: string;
  mode: MechanicalVentilationMode;
  lifecycle: MechanicalVentilationLifecycle;
  airwayValid: boolean;
  externalSupportActive: boolean;
  respiratoryRate: number;
  respiratoryRateUnit: typeof VENTILATION_RATE_UNIT;
  tidalVolumeMl: number;
  tidalVolumeUnit: typeof TIDAL_VOLUME_UNIT;
  mechanicalMinuteVentilationLMin: number;
  fio2: number;
  peepCmH2O: number;
  peepUnit: typeof PEEP_UNIT;
  peepPhysiologicEffect: "DEFERRED_NO_GENERIC_RECRUITMENT_MODEL";
  spontaneousRespiratoryRate?: number;
  medicationRespiratoryDepression: number;
  effectiveRespiratoryRate: number;
  startedAtSimulationTimeSec: number;
  lastSettingsChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  stopReason?: MechanicalVentilationStopReason;
}>;

export type MechanicalVentilationRuntimeSnapshot = Readonly<{
  schemaVersion: 1;
  configuration: MechanicalVentilationConfiguration;
  supports: readonly MechanicalVentilationState[];
  commandResults: readonly MechanicalVentilationCommandResult[];
  events: readonly MechanicalVentilationRuntimeEvent[];
}>;

export type ExternalMechanicalVentilationSupport = Readonly<{
  supportId: string;
  patientId: string;
  respiratoryRate: number;
  tidalVolumeMl: number;
  mechanicalMinuteVentilationLMin: number;
  fio2: number;
  peepCmH2O: number;
}>;
