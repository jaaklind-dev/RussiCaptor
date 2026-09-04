import type { ClinicalFeatureLifecycle } from "@/models/ClinicalFeatureContract";

export const RINGER_FEATURE_ID = "RINGER" as const;
export const SODIUM_CHLORIDE_0_9_FEATURE_ID = "SODIUM_CHLORIDE_0_9" as const;
export const FLUID_VOLUME_UNIT = "ML" as const;
export const FLUID_RATE_UNIT = "ML_H" as const;

export type FluidAdministrationMode = "BOLUS" | "INFUSION";
export type FluidAdministrationStatus = ClinicalFeatureLifecycle | "COMPLETED";
export type FluidProductClass = "CRYSTALLOID" | "COLLOID";
export type SupportedFluidType = typeof RINGER_FEATURE_ID | typeof SODIUM_CHLORIDE_0_9_FEATURE_ID;

export type FluidTherapyConfiguration<TFluidType extends string = string> = Readonly<{
  schemaVersion: 1;
  version: string;
  fluidType: TFluidType;
  effectiveIntravascularFraction: number;
  maximumPrescribedVolumeMl: number;
  maximumRateMlHour: number;
  vitalResponsePer1000EffectiveMl: Readonly<{
    heartRateDelta: number;
    systolicBpDelta: number;
    diastolicBpDelta: number;
    crtDelta: number;
  }>;
}>;

export type FluidTherapyProductDefinition<TFluidType extends string = string> = Readonly<{
  fluidClass: FluidProductClass;
  configuration: FluidTherapyConfiguration<TFluidType>;
}>;

export type FluidTherapyAdministrationState<TFluidType extends string = string> = Readonly<{
  schemaVersion: 1;
  featureId: TFluidType;
  administrationId: string;
  patientId: string;
  fluidType: TFluidType;
  route: "IV" | "IO";
  vascularAccessId: string;
  mode: FluidAdministrationMode;
  status: FluidAdministrationStatus;
  prescribedVolumeMl?: number;
  rateMlHour: number;
  deliveredVolumeMl: number;
  deliveredVolumeAtLastChangeMl: number;
  startedAtSimulationTimeSec: number;
  lastRateChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
}>;

export type FluidTherapyCommand<TFluidType extends string = string> = Readonly<{
  commandId: string;
  action: "START" | "CHANGE_RATE" | "STOP";
  administrationId: string;
  patientId: string;
  fluidType: TFluidType;
  simulationTimeSec: number;
  mode?: FluidAdministrationMode;
  prescribedVolumeMl?: number;
  volumeUnit?: string;
  rateMlHour?: number;
  rateUnit?: string;
  vascularAccessId?: string;
}>;

export type FluidTherapyRejectionReason =
  | "INVALID_COMMAND" | "INVALID_MODE" | "INVALID_VOLUME" | "INVALID_RATE"
  | "INVALID_UNIT" | "INVALID_FLUID_TYPE" | "MISSING_VASCULAR_ACCESS"
  | "INVALID_PATIENT" | "ADMINISTRATION_NOT_FOUND" | "INVALID_STATE" | "STALE_SIMULATION_TIME";

export type FluidTherapyCommandResult<TFluidType extends string = string> = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "NO_OP" | "REJECTED";
  commandId: string;
  state?: FluidTherapyAdministrationState<TFluidType>;
  rejectionReason?: FluidTherapyRejectionReason;
}>;

export type FluidTherapyRuntimeEvent<TFluidType extends string = string> = Readonly<{
  eventType: "FluidAdministrationStarted" | "FluidAdministrationRateChanged" |
    "FluidAdministrationStopped" | "FluidAdministrationCompleted" | "FluidAdministrationRejected";
  commandId?: string;
  administrationId: string;
  patientId: string;
  fluidType: TFluidType;
  timestamp: number;
  deliveredVolumeMl: number;
  rateMlHour: number;
  reasonCode?: FluidTherapyRejectionReason;
}>;

export type FluidTherapyRuntimeSnapshot<TFluidType extends string = string> = Readonly<{
  schemaVersion: 1;
  configuration: FluidTherapyConfiguration<TFluidType>;
  administrations: readonly FluidTherapyAdministrationState<TFluidType>[];
  commandResults: readonly FluidTherapyCommandResult<TFluidType>[];
  events: readonly FluidTherapyRuntimeEvent<TFluidType>[];
}>;

export type FluidTherapyPersistenceSnapshot = FluidTherapyRuntimeSnapshot<typeof RINGER_FEATURE_ID> & Readonly<{
  additionalProducts?: readonly FluidTherapyRuntimeSnapshot<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID>[];
}>;

export type FluidTherapyFeatureProjection<TFluidType extends string = string> = Readonly<{
  featureId: TFluidType;
  administrationId: string;
  patientId: string;
  fluidType: TFluidType;
  fluidClass: FluidProductClass;
  mode: FluidAdministrationMode;
  status: FluidAdministrationStatus;
  vascularAccessId: string;
  prescribedVolumeMl?: number;
  currentRateMlHour: number;
  cumulativeDeliveredVolumeMl: number;
  effectiveIntravascularVolumeMl: number;
  startedAtSimulationTimeSec: number;
  lastRateChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
}>;

export type SupportedFluidTherapyCommand =
  | FluidTherapyCommand<typeof RINGER_FEATURE_ID>
  | FluidTherapyCommand<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID>;
export type SupportedFluidTherapyCommandResult =
  | FluidTherapyCommandResult<typeof RINGER_FEATURE_ID>
  | FluidTherapyCommandResult<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID>;
export type SupportedFluidTherapyProjection =
  | FluidTherapyFeatureProjection<typeof RINGER_FEATURE_ID>
  | FluidTherapyFeatureProjection<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID>;
export type SupportedFluidTherapyEvent =
  | FluidTherapyRuntimeEvent<typeof RINGER_FEATURE_ID>
  | FluidTherapyRuntimeEvent<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID>;
