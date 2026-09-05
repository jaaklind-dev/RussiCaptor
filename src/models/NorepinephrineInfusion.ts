import type { ClinicalFeatureLifecycle } from "@/models/ClinicalFeatureContract";

export const NOREPINEPHRINE_FEATURE_ID = "NOREPINEPHRINE" as const;
export const NOREPINEPHRINE_DOSE_UNIT = "MCG_KG_MIN" as const;

export type NorepinephrineConfiguration = Readonly<{
  version: "NOREPINEPHRINE_PD_V1";
  minimumDoseMicrogramsPerKgMin: number;
  minimumNonZeroDoseMicrogramsPerKgMin: number;
  maximumDoseMicrogramsPerKgMin: number;
  halfMaximumDoseMicrogramsPerKgMin: number;
  maximumSystolicIncreaseMmHg: number;
  maximumDiastolicIncreaseMmHg: number;
  onsetDurationSec: number;
  doseChangeDurationSec: number;
  decayDurationSec: number;
}>;
export type NorepinephrineTransition = Readonly<{
  startedAtSimulationTimeSec: number;
  durationSec: number;
  fromSystolicIncreaseMmHg: number;
  toSystolicIncreaseMmHg: number;
  fromDiastolicIncreaseMmHg: number;
  toDiastolicIncreaseMmHg: number;
}>;

export type NorepinephrineInfusionState = Readonly<{
  schemaVersion: 1;
  featureId: typeof NOREPINEPHRINE_FEATURE_ID;
  infusionId: string;
  patientId: string;
  route: "IV";
  vascularAccessId: string;
  status: ClinicalFeatureLifecycle;
  doseMicrogramsPerKgMin: number;
  unit: typeof NOREPINEPHRINE_DOSE_UNIT;
  startedAtSimulationTimeSec: number;
  lastDoseChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  transition: NorepinephrineTransition;
}>;

export type NorepinephrineCommand = Readonly<{
  commandId: string;
  action: "START" | "CHANGE_DOSE" | "STOP";
  infusionId: string;
  patientId: string;
  simulationTimeSec: number;
  doseMicrogramsPerKgMin?: number;
  unit?: string;
  vascularAccessId?: string;
}>;

export type NorepinephrineCommandStatus =
  | "APPLIED" | "IDEMPOTENT" | "NO_OP" | "REJECTED";

export type NorepinephrineRejectionReason =
  | "INVALID_COMMAND" | "INVALID_DOSE" | "INVALID_UNIT" | "MISSING_VASCULAR_ACCESS"
  | "ALREADY_ACTIVE" | "INFUSION_NOT_FOUND" | "INVALID_STATE" | "STALE_SIMULATION_TIME";

export type NorepinephrineCommandResult = Readonly<{
  status: NorepinephrineCommandStatus;
  commandId: string;
  state?: NorepinephrineInfusionState;
  rejectionReason?: NorepinephrineRejectionReason;
}>;

export type NorepinephrineRuntimeEvent = Readonly<{
  eventType: "NorepinephrineInfusionStarted" | "NorepinephrineDoseChanged" |
    "NorepinephrineInfusionStopping" | "NorepinephrineInfusionStopped" | "NorepinephrineCommandRejected";
  commandId?: string;
  infusionId: string;
  patientId: string;
  timestamp: number;
  doseMicrogramsPerKgMin: number;
  unit: typeof NOREPINEPHRINE_DOSE_UNIT;
  reasonCode?: NorepinephrineRejectionReason;
}>;

export type NorepinephrineRuntimeSnapshot = Readonly<{
  schemaVersion: 1;
  configuration: NorepinephrineConfiguration;
  infusions: readonly NorepinephrineInfusionState[];
  commandResults: readonly NorepinephrineCommandResult[];
  events: readonly NorepinephrineRuntimeEvent[];
}>;

export type NorepinephrineFeatureProjection = Readonly<{
  featureId: typeof NOREPINEPHRINE_FEATURE_ID;
  infusionId: string;
  patientId: string;
  route: "IV";
  vascularAccessId: string;
  status: ClinicalFeatureLifecycle;
  doseMicrogramsPerKgMin: number;
  unit: typeof NOREPINEPHRINE_DOSE_UNIT;
  currentSystolicIncreaseMmHg: number;
  currentDiastolicIncreaseMmHg: number;
  startedAtSimulationTimeSec: number;
  lastDoseChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
}>;
