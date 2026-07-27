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
