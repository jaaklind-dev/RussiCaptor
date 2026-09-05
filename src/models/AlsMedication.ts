import type { CardiacRhythm, CardiacRhythmClassification, CardiacState } from "@/models/PatientProcessRuntime";

export const ERC_2025_ADULT_ALS_PROFILE_ID = "ERC_2025_ADULT_ALS" as const;

export type AlsMedicationId = "ADRENALINE" | "AMIODARONE" | "LIDOCAINE" | "ATROPINE" |
  "ADENOSINE" | "MAGNESIUM_SULFATE" | "CALCIUM_CHLORIDE" | "SODIUM_BICARBONATE";
export type AlsMedicationRoute = "IV" | "IO";
export type AlsDoseUnit = "MG" | "MCG" | "MMOL" | "ML";
export type AlsMedicationContext = "CARDIAC_ARREST" | "PERI_ARREST" | "REVERSIBLE_CAUSE";
export type AlsProtocolClassification =
  | "GUIDELINE_ELIGIBLE"
  | "OVERDUE_GUIDELINE_ELIGIBLE"
  | "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM"
  | "REPEAT_TOO_SOON"
  | "OUTSIDE_CARDIAC_ARREST_CONTEXT"
  | "WRONG_RHYTHM"
  | "WRONG_SHOCK_COUNT"
  | "WRONG_DOSE"
  | "DUPLICATE_COURSE_DOSE"
  | "ANTIARRHYTHMIC_STRATEGY_CONFLICT"
  | "BRADYCARDIA_ADVERSE_SIGNS_REQUIRED"
  | "CUMULATIVE_DOSE_EXCEEDED"
  | "INAPPROPRIATE_IN_CARDIAC_ARREST"
  | "SEQUENCE_MISMATCH"
  | "SPECIFIC_INDICATION_REQUIRED"
  | "SUBSTRATE_UNMODELED";

export type AlsMedicationProductConfiguration = Readonly<{
  schemaVersion: 1;
  drugId: AlsMedicationId;
  displayName: string;
  aliases: readonly string[];
  context: AlsMedicationContext;
  routes: readonly AlsMedicationRoute[];
  doseUnit: AlsDoseUnit;
  referenceDoses: readonly number[];
  concentrationId?: "CALCIUM_CHLORIDE_10_PERCENT";
  modeledEffect: "ARREST_VASOACTIVE" | "ANTIARRHYTHMIC" | "BRADYCARDIA_RATE" |
    "TRANSIENT_AV_NODAL" | "TORSADES_SUSCEPTIBILITY" | "DEFERRED_SUBSTRATE";
  effectDurationSec: number;
}>;

export type Erc2025AdultAlsProfile = Readonly<{
  profileId: typeof ERC_2025_ADULT_ALS_PROFILE_ID;
  version: "2025.1";
  adrenaline: Readonly<{ doseMg: 1; repeatMinSec: 180; repeatMaxSec: 300; firstShockableDoseAfterShock: 3 }>;
  amiodarone: Readonly<{ doseSequenceMg: readonly [300, 150]; shockSequence: readonly [3, 5] }>;
  lidocaine: Readonly<{ doseSequenceMg: readonly [100, 50]; shockSequence: readonly [3, 5] }>;
  atropine: Readonly<{ doseMcg: 500; repeatMinSec: 180; repeatMaxSec: 300; maximumCumulativeMcg: 3000 }>;
  adenosine: Readonly<{ doseSequenceMg: readonly [6, 12, 18]; rapidIvOnly: true }>;
  magnesium: Readonly<{ doseMg: 2000; equivalentMmol: 8 }>;
  calciumChloride: Readonly<{ doseMl: 10; concentrationId: "CALCIUM_CHLORIDE_10_PERCENT" }>;
  sodiumBicarbonate: Readonly<{ doseMmol: 50 }>;
  products: readonly AlsMedicationProductConfiguration[];
}>;

export type AlsRhythmContext = Readonly<{
  patientId: string;
  cardiacState: CardiacState;
  rhythm: CardiacRhythm;
  rhythmClassification: CardiacRhythmClassification;
  shockAttemptCount: number;
  cprActive: boolean;
  adverseSigns?: boolean;
  hyperkalaemiaSubstrate: "UNMODELED" | "ABSENT" | "HYPERKALAEMIA_WITH_ECG_CHANGES";
}>;

export type AlsMedicationCommand = Readonly<{
  commandId: string;
  administrationId: string;
  patientId: string;
  drugId: AlsMedicationId;
  route: AlsMedicationRoute;
  vascularAccessId: string;
  dose: number;
  doseUnit: AlsDoseUnit;
  concentrationId?: "CALCIUM_CHLORIDE_10_PERCENT";
  simulationTimeSec: number;
}>;

export type AlsMedicationAdministrationState = Readonly<{
  schemaVersion: 1;
  profileId: typeof ERC_2025_ADULT_ALS_PROFILE_ID;
  administrationId: string;
  commandId: string;
  patientId: string;
  drugId: AlsMedicationId;
  route: AlsMedicationRoute;
  vascularAccessId: string;
  dose: number;
  doseUnit: AlsDoseUnit;
  concentrationId?: "CALCIUM_CHLORIDE_10_PERCENT";
  simulationTimeSec: number;
  cardiacStateAtAdministration: CardiacState;
  rhythmAtAdministration: CardiacRhythm;
  rhythmClassificationAtAdministration: CardiacRhythmClassification;
  shockCountAtAdministration: number;
  cprActiveAtAdministration: boolean;
  adverseSignsAtAdministration?: boolean;
  hyperkalaemiaSubstrateAtAdministration: AlsRhythmContext["hyperkalaemiaSubstrate"];
  protocolClassification: AlsProtocolClassification;
  modeledEffect: AlsMedicationProductConfiguration["modeledEffect"];
  effectActiveUntilSimulationTimeSec?: number;
  physiologyStatus: "ACTIVE" | "NO_DIRECT_EFFECT" | "DEFERRED_NO_SUBSTRATE";
}>;

export type AlsMedicationCourseProjection = Readonly<{
  patientId: string;
  lastAdrenalineSimulationTimeSec?: number;
  cumulativeAdrenalineMg: number;
  antiarrhythmicStrategy?: "AMIODARONE" | "LIDOCAINE" | "MIXED";
  amiodaroneDosesMg: readonly number[];
  lidocaineDosesMg: readonly number[];
  atropineCumulativeMcg: number;
  adenosineDosesMg: readonly number[];
}>;

export type AlsMedicationFeatureProjection = AlsMedicationAdministrationState & Readonly<{
  featureId: AlsMedicationId;
  category: "ALS_MEDICATION";
  effectActive: boolean;
  currentEffect: Readonly<{
    arrestVasoactiveSupport: number;
    antiarrhythmicSupport: number;
    heartRateIncreaseBpm: number;
    avNodalEffect: number;
    torsadesSusceptibilityReduction: number;
  }>;
  course: AlsMedicationCourseProjection;
}>;

export type AlsMedicationRejectionReason = "INVALID_COMMAND" | "UNKNOWN_DRUG" | "INVALID_DOSE" |
  "INVALID_UNIT" | "INVALID_ROUTE" | "MISSING_VASCULAR_ACCESS" | "INVALID_PATIENT" |
  "MISSING_RHYTHM_CONTEXT" | "DUPLICATE_ADMINISTRATION" | "STALE_SIMULATION_TIME";

export type AlsMedicationCommandResult = Readonly<{
  status: "APPLIED" | "IDEMPOTENT" | "REJECTED";
  commandId: string;
  state?: AlsMedicationAdministrationState;
  rejectionReason?: AlsMedicationRejectionReason;
}>;

export type AlsMedicationRuntimeEvent = Readonly<{
  eventType: "AlsMedicationAdministered" | "AlsMedicationCommandRejected";
  commandId: string;
  administrationId: string;
  patientId: string;
  drugId: AlsMedicationId;
  timestamp: number;
  protocolClassification?: AlsProtocolClassification;
  rejectionReason?: AlsMedicationRejectionReason;
}>;

export type AlsMedicationRuntimeSnapshot = Readonly<{
  schemaVersion: 1;
  profileId: typeof ERC_2025_ADULT_ALS_PROFILE_ID;
  administrations: readonly AlsMedicationAdministrationState[];
  commandResults: readonly AlsMedicationCommandResult[];
  events: readonly AlsMedicationRuntimeEvent[];
}>;
