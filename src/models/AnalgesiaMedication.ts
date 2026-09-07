export const ANALGESIA_FEATURE_ID = "ANALGESIA" as const;

export const ANALGESIC_DRUG_IDS = Object.freeze([
  "FENTANYL", "REMIFENTANIL", "KETAMINE", "PARACETAMOL", "ESKETAMINE",
  "MORPHINE", "OXYCODONE", "KETOPROFEN", "DEXKETOPROFEN", "PROPOFOL", "MIDAZOLAM", "ROCURONIUM",
] as const);
export type AnalgesicDrugId = typeof ANALGESIC_DRUG_IDS[number];
export type AnalgesicDrugInputId = AnalgesicDrugId | "DOLMEN";
export type AnalgesicDrugClass = "OPIOID" | "DISSOCIATIVE_ANALGESIC" | "NON_OPIOID_ANALGESIC" | "NSAID" |
  "HYPNOTIC_SEDATIVE" | "BENZODIAZEPINE_SEDATIVE" | "NEUROMUSCULAR_BLOCKER";
export type AnalgesicAdministrationMode = "BOLUS" | "INFUSION";
export type AnalgesicLifecycle = "RUNNING" | "STOPPED" | "COMPLETED";
export type AnalgesicDoseUnit = "MCG" | "MG" | "MCG_KG" | "MG_KG";
export type AnalgesicRateUnit = "MCG_KG_MIN" | "MCG_MIN" | "MG_H";

export type AnalgesicEffectDimensions = Readonly<{
  analgesia: number;
  sedation: number;
  respiratoryDepression: number;
  dissociation: number;
  sympatheticEffect: number;
  hemodynamicDepression: number;
  antiInflammatoryAnalgesia: number;
  hypnosis?: number;
  neuromuscularBlockade?: number;
}>;

export type AnalgesicProductConfiguration = Readonly<{
  schemaVersion: 1;
  version: string;
  drugId: AnalgesicDrugId;
  displayName: string;
  aliases: readonly string[];
  drugClass: AnalgesicDrugClass;
  routes: readonly ("IV" | "IO")[];
  modes: readonly AnalgesicAdministrationMode[];
  bolusDoseUnit?: AnalgesicDoseUnit;
  infusionRateUnit?: AnalgesicRateUnit;
  referenceExposureDose: number;
  maximumBolusDose?: number;
  maximumInfusionRate?: number;
  bolusDeliveryDurationSec: number;
  onsetDurationSec: number;
  effectHalfLifeSec: number;
  effects: AnalgesicEffectDimensions;
}>;

export type AnalgesicAdministrationState = Readonly<{
  schemaVersion: 1;
  featureId: typeof ANALGESIA_FEATURE_ID;
  administrationId: string;
  patientId: string;
  drugId: AnalgesicDrugId;
  productVersion: string;
  route: "IV" | "IO";
  vascularAccessId: string;
  mode: AnalgesicAdministrationMode;
  lifecycle: AnalgesicLifecycle;
  prescribedDose?: number;
  doseUnit?: AnalgesicDoseUnit;
  rate?: number;
  rateUnit?: AnalgesicRateUnit;
  deliveredDose: number;
  deliveredDoseAtLastChange: number;
  startedAtSimulationTimeSec: number;
  lastRateChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
  terminalExposureAnchor?: number;
}>;

export type AnalgesicPainState = Readonly<{
  patientId: string;
  baselinePainIntensity: number;
}>;

export type AnalgesicCommand = Readonly<{
  commandId: string;
  action: "START" | "CHANGE_RATE" | "STOP";
  administrationId: string;
  patientId: string;
  drugId: AnalgesicDrugInputId | string;
  simulationTimeSec: number;
  mode?: AnalgesicAdministrationMode;
  route?: "IV" | "IO";
  vascularAccessId?: string;
  dose?: number;
  doseUnit?: string;
  rate?: number;
  rateUnit?: string;
}>;

export type AnalgesicRejectionReason = "INVALID_COMMAND" | "UNKNOWN_DRUG" | "INVALID_MODE" |
  "INVALID_ROUTE" | "INVALID_DOSE" | "INVALID_RATE" | "INVALID_UNIT" |
  "MISSING_VASCULAR_ACCESS" | "INVALID_PATIENT" | "ADMINISTRATION_NOT_FOUND" |
  "INVALID_STATE" | "STALE_SIMULATION_TIME";

export type AnalgesicCommandResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "NO_OP" | "REJECTED";
  commandId: string;
  state?: AnalgesicAdministrationState;
  rejectionReason?: AnalgesicRejectionReason;
}>;

export type AnalgesicRuntimeEvent = Readonly<{
  eventType: "AnalgesicAdministrationStarted" | "AnalgesicRateChanged" |
    "AnalgesicAdministrationStopped" | "AnalgesicAdministrationCompleted" | "AnalgesicCommandRejected";
  commandId?: string;
  administrationId: string;
  patientId: string;
  drugId: AnalgesicDrugId | "UNKNOWN";
  timestamp: number;
  lifecycle: AnalgesicLifecycle;
  deliveredDose: number;
  reasonCode?: AnalgesicRejectionReason;
}>;

export type AnalgesicAggregateProjection = AnalgesicEffectDimensions & Readonly<{
  patientId: string;
  baselinePainIntensity: number;
  currentPainIntensity: number;
  rass?: number;
  bis?: number;
  trainOfFour?: 0 | 1 | 2 | 3 | 4;
}>;

export type AnalgesicFeatureProjection = AnalgesicEffectDimensions & Readonly<{
  featureId: typeof ANALGESIA_FEATURE_ID;
  administrationId: string;
  patientId: string;
  drugId: AnalgesicDrugId;
  displayName: string;
  aliases: readonly string[];
  drugClass: AnalgesicDrugClass;
  route: "IV" | "IO";
  vascularAccessId: string;
  mode: AnalgesicAdministrationMode;
  lifecycle: AnalgesicLifecycle;
  prescribedDose?: number;
  doseUnit?: AnalgesicDoseUnit;
  currentRate?: number;
  rateUnit?: AnalgesicRateUnit;
  deliveredDose: number;
  startedAtSimulationTimeSec: number;
  lastRateChangeAtSimulationTimeSec: number;
  stoppedAtSimulationTimeSec?: number;
  completedAtSimulationTimeSec?: number;
  normalizedExposure: number;
  baselinePainIntensity: number;
  currentPainIntensity: number;
  rass?: number;
  bis?: number;
  trainOfFour?: 0 | 1 | 2 | 3 | 4;
}>;

export type AnalgesiaRuntimeSnapshot = Readonly<{
  schemaVersion: 1;
  productConfigurations: readonly AnalgesicProductConfiguration[];
  administrations: readonly AnalgesicAdministrationState[];
  painStates: readonly AnalgesicPainState[];
  commandResults: readonly AnalgesicCommandResult[];
  events: readonly AnalgesicRuntimeEvent[];
}>;
