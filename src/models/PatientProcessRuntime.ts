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
