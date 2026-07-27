import type { ProcessOutput } from "@/models/RuntimeAggregation";

export type HvProcessState = {
  ventilationReserve: number;
  reserveLossPerMin: number;
  co2Burden: number;
  co2GainPerMin: number;
  causeControlled: boolean;
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
};
