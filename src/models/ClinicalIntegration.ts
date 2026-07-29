import type { HypoxiaPatientProcessRuntime, PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

export type ClinicalParameterValue = string | number | boolean | null;

export type ClinicalInputSourceKind = "SCENARIO" | "INTERVENTION" | "OBSERVATION" | "ENGINE";

export type ClinicalIntegrationInput = {
  inputId: string;
  encounterId: string;
  patientId: string;
  timestamp: number;
  inputType: "CLINICAL_EFFECT";
  source: { kind: ClinicalInputSourceKind; sourceId: string };
  payload: ClinicalEffect;
};

export type ClinicalEffectType =
  | "INSPIRED_OXYGEN_INCREASED"
  | "INSPIRED_OXYGEN_REMOVED"
  | "UPPER_AIRWAY_PATENCY"
  | "AIRWAY_PROTECTED"
  | "EFFECTIVE_VENTILATION"
  | "VASCULAR_ACCESS_AVAILABLE"
  | "INFUSION_RUNNING"
  | "REDUCE_EXTERNAL_BLEEDING"
  | "PELVIC_STABILIZATION";

export type ClinicalEffect = {
  effectId: string;
  effectType: ClinicalEffectType;
  encounterId: string;
  patientId: string;
  timestamp: number;
  sourceInterventionInstanceId: string;
  parameters: Record<string, ClinicalParameterValue>;
  duration?: number;
};

export type ClinicalProcessRuntime = PatientProcessRuntime | HypoxiaPatientProcessRuntime;

export type ClinicalIntegrationRejectionCode =
  | "INVALID_INPUT"
  | "ENCOUNTER_MISMATCH"
  | "STALE_INPUT"
  | "DUPLICATE_INPUT"
  | "NO_ACTIVE_PROCESS"
  | "UNSUPPORTED_INPUT"
  | "AMBIGUOUS_TARGET"
  | "PROCESS_REJECTED";

export type ClinicalIntegrationEvent = {
  eventType: "ClinicalEffectApplied" | "ClinicalEffectRejected";
  timestamp: number;
  inputId: string;
  encounterId: string;
  sourceId: string;
  sourceProcessId?: string;
  instanceKey?: string;
  effectType: ClinicalEffectType;
  reasonCode?: ClinicalIntegrationRejectionCode;
};

export type ClinicalProcessResult = {
  process: ClinicalProcessRuntime;
  event: ClinicalIntegrationEvent;
};

export type ClinicalIntegrationResult = {
  status: "APPLIED" | "NO_OP" | "REJECTED";
  processes: ClinicalProcessRuntime[];
  outputs: ProcessOutput[];
  events: ClinicalIntegrationEvent[];
  rejection?: { reasonCode: ClinicalIntegrationRejectionCode; detail: string };
};

export type ClinicalProcessHandler = {
  processType: string;
  accepts(input: ClinicalIntegrationInput, process: ClinicalProcessRuntime): boolean;
  apply(input: ClinicalIntegrationInput, process: ClinicalProcessRuntime): ClinicalProcessResult;
};
