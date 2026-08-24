import type { ProcessOutput } from "@/models/RuntimeAggregation";

export type HvProcessState = {
  ventilationReserve: number;
  reserveLossPerMin: number;
  co2Burden: number;
  co2GainPerMin: number;
  causeControlled: boolean;
  airwayProtected: boolean;
  effectiveVentilationActive: boolean;
  directOxygenEffectOnCO2: number;
  reserveSupportPerMin: number;
  co2ClearancePerMin: number;
  ventilationEffectCount: number;
  definitiveControl: boolean;
  respiratoryArrest: boolean;
  mentalStatusSourceModule?: string;
  mentalStatusSourceProcessType?: string;
  oxygenTherapyActive: boolean;
  co2Trend: "STABLE" | "IMPROVING" | "WORSENING";
  oxygenMaskingWarningEmitted: boolean;
};

export type PatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: string;
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  clinicalState: HvProcessState;
  outputs: ProcessOutput;
  nextTick: number;
  parentProcessId?: string;
  parentProcessType?: string;
};

export type HypoxiaProcessState = {
  oxygenationReserve: number;
  spo2: number;
  oxygenTherapyActive: boolean;
  spo2Trend: "STABLE" | "IMPROVING" | "WORSENING";
};

export type HypoxiaPatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: "HYPOXIA";
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  clinicalState: HypoxiaProcessState;
  outputs: ProcessOutput;
  nextTick: number;
  parentProcessId?: string;
  parentProcessType?: string;
};

export type BotulismChildProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: string;
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  initialReserve: number;
  progressionRate: number;
  outputs: ProcessOutput;
  nextTick: number;
  parentProcessId?: string;
  parentProcessType?: string;
};

export type BotulismRootPatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: "BOTULISM_ROOT";
  templateId: "BOTULISM_ROOT";
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  outputs: ProcessOutput;
  nextTick: number;
  children: BotulismChildProcessRuntime[];
};

export type RespiratoryFailurePhenotype = "HYPOXAEMIC" | "HYPERCAPNIC" | "MIXED";

export type RespiratoryFailureConfiguration = {
  version: string;
  spo2ContributorEnabled?: boolean;
  initial: {
    spo2: number;
    respiratoryRate: number;
    etco2: number;
    gcs: number;
    workOfBreathing: number;
    fatigue: number;
  };
  progression: {
    spo2DeclinePerMin: number;
    respiratoryRateChangePerMin: number;
    etco2RisePerMin: number;
    workOfBreathingRisePerMin: number;
    fatigueRisePerMin: number;
    gcsDeclinePerMin: number;
  };
  support: {
    oxygenSpo2RecoveryPerMin: number;
    patentAirwayWorkRecoveryPerMin: number;
    bvmSpo2RecoveryPerMin: number;
    bvmEtco2ClearancePerMin: number;
    bvmFatigueRecoveryPerMin: number;
    mechanicalSpo2RecoveryPerMin: number;
    mechanicalEtco2ClearancePerMin: number;
    mechanicalFatigueRecoveryPerMin: number;
  };
  limits: {
    spo2: { min: number; max: number };
    respiratoryRate: { min: number; max: number };
    etco2: { min: number; max: number };
    gcs: { min: number; max: number };
    workOfBreathing: { min: number; max: number };
    fatigue: { min: number; max: number };
  };
  recovery: { resolvedFatigueMax: number; resolvedWorkOfBreathingMax: number };
};

export type RespiratoryFailureProcessState = {
  phenotype: RespiratoryFailurePhenotype;
  spo2: number;
  respiratoryRate: number;
  etco2: number;
  gcs: number;
  workOfBreathing: number;
  fatigue: number;
  oxygenSupport: boolean;
  oxygenTherapyActive: boolean;
  airwayPatent: boolean;
  airwayProtected: boolean;
  ventilationMode: "NONE" | "BVM" | "MECHANICAL";
  trend: "STABLE" | "IMPROVING" | "WORSENING";
};

export type RespiratoryFailurePatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: "RESPIRATORY_FAILURE";
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  clinicalState: RespiratoryFailureProcessState;
  configuration: RespiratoryFailureConfiguration;
  outputs: ProcessOutput;
  nextTick: number;
  parentProcessId?: string;
  parentProcessType?: string;
};

export type PleuralInjuryConfiguration = Readonly<{
  version: string;
  initialAirBurden: number;
  initialBloodBurdenMl: number;
  airAccumulationPerMin: number;
  bloodAccumulationPerMin: number;
  drainedAirReduction: number;
  drainedBloodReductionMl: number;
  drainageAirAccumulationMultiplier: number;
  maximumBloodBurdenMl: number;
  /** Optional versioned extension. Omitted configurations retain WP-44/V1 behavior byte-for-byte. */
  initialDrainageVolumeMl?: number;
  ongoingDrainOutputRateMlMin?: number;
  /** Generic canonical recovery contributed by a functioning pleural drain. */
  postDrainRespiratoryRecovery?: PleuralRespiratoryRecoveryConfiguration;
}>;

export type PleuralRespiratoryRecoveryConfiguration = Readonly<{
  spo2RecoveryPerMin: number;
  spo2Ceiling: number;
  respiratoryRateRecoveryPerMin: number;
  respiratoryRateFloor: number;
  workOfBreathingRecoveryPerMin: number;
  workOfBreathingFloor: number;
  fatigueRecoveryPerMin: number;
  fatigueFloor: number;
}>;

export type PleuralInjuryPatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: "PLEURAL_INJURY";
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  clinicalState: {
    airBurden: number;
    bloodBurdenMl: number;
    drainageActive: boolean;
    drainedAir: number;
    drainedBloodMl: number;
    initialDrainageCompleted?: boolean;
    initialDrainageVolumeMl?: number;
    ongoingDrainOutputMl?: number;
    totalDrainOutputMl?: number;
    ongoingDrainRateMlMin?: number;
    drainageCompletedAtSec?: number;
    appliedEffectIds: string[];
    /** Compatibility discriminator for the existing clinical process registry. Pleural injury never owns oxygen therapy. */
    oxygenTherapyActive: false;
  };
  configuration: PleuralInjuryConfiguration;
  outputs: ProcessOutput;
  nextTick: number;
};

export type CardiacState = "PERFUSING" | "ARREST" | "ROSC";
export type CardiacRhythm = "VF" | "PULSELESS_VT" | "PEA" | "ASYSTOLE" | "PERFUSING";
export type CardiacRhythmClassification = "SHOCKABLE" | "NON_SHOCKABLE" | "PERFUSING";

export type CardiacVitalTargets = Readonly<{
  heartRate: number;
  systolicBp: number;
  diastolicBp: number;
  respiratoryRate: number;
  gcs: number;
}>;

export type CardiacRhythmTransition = Readonly<{
  transitionId: string;
  trigger: "TIME" | "SHOCK" | "EXPLICIT";
  fromRhythm: CardiacRhythm;
  toRhythm: CardiacRhythm;
  atSec?: number;
  shockAttempt?: number;
  priority: number;
}>;

export type CardiacArrestConfiguration = Readonly<{
  version: string;
  initialState: CardiacState;
  initialRhythm: CardiacRhythm;
  initialCprActive: boolean;
  vitalTargets: Readonly<{
    arrestWithoutCpr: CardiacVitalTargets;
    arrestWithCpr: CardiacVitalTargets;
    perfusing: CardiacVitalTargets;
    rosc: CardiacVitalTargets;
  }>;
  transitions: readonly CardiacRhythmTransition[];
}>;

export type CardiacProcessEvidence = Readonly<{
  eventType: "CPR_STARTED" | "CPR_STOPPED" | "DEFIBRILLATION_ATTEMPTED" | "CARDIAC_RHYTHM_TRANSITION" | "ROSC_ACHIEVED" | "CARDIAC_REARREST";
  details: Readonly<Record<string, unknown>>;
}>;

export type CardiacArrestPatientProcessRuntime = {
  processId: string;
  encounterId: string;
  instanceKey: string;
  processType: "CARDIAC_ARREST";
  templateId: string;
  state: "Active" | "Controlled" | "Resolved";
  elapsedTime: number;
  clinicalState: {
    cardiacState: CardiacState;
    rhythm: CardiacRhythm;
    rhythmClassification: CardiacRhythmClassification;
    cprActive: boolean;
    /** Compatibility discriminator shared by existing clinical process consumers; cardiac process never owns oxygen therapy. */
    oxygenTherapyActive: false;
      shockAttemptCount: number;
    appliedEffectIds: string[];
  };
  configuration: CardiacArrestConfiguration;
  outputs: ProcessOutput;
  nextTick: number;
  pendingEvidence: CardiacProcessEvidence[];
  parentProcessId?: string;
  parentProcessType?: string;
};
