import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

export type HemorrhageSeverity = "NONE" | "MINOR" | "MODERATE" | "SEVERE" | "CATASTROPHIC";
export type PerfusionState = "NORMAL" | "COMPENSATED" | "DECOMPENSATED" | "CRITICAL";
export type CompensationState = "COMPENSATED" | "FAILING" | "FAILED";
export type HemorrhageConfiguration = {
  baselineBleedingRateMlMin: number;
  tourniquetEfficiency: number;
  binderEfficiency: number;
  infusionOffsetMlMin: number;
  bloodProductOffsetMlMin: number;
  severityThresholdsMl: [number, number, number, number];
  perfusionThresholdsMl: [number, number, number];
  compensationThresholdsMl: [number, number];
  trendThresholdsMlMin: { worsening: number; improving: number };
};
export type HemorrhageClinicalState = {
  estimatedBloodLossMl: number;
  cumulativeLossMl: number;
  bleedingRateMlMin: number;
  activeHemorrhage: boolean;
  severity: HemorrhageSeverity;
  perfusion: PerfusionState;
  compensation: CompensationState;
  heartRateTrend: "STABLE" | "RISING" | "FALLING";
  bloodPressureTrend: "STABLE" | "RISING" | "FALLING";
  perfusionTrend: "STABLE" | "IMPROVING" | "WORSENING";
  activeEffects: ClinicalEffect[];
  resolvedEffectIds: string[];
};
export type HemorrhagePatientProcessRuntime = {
  processId: string; encounterId: string; instanceKey: string; processType: "HEMORRHAGE";
  templateId: string; state: "Active" | "Controlled" | "Resolved"; elapsedTime: number;
  clinicalState: HemorrhageClinicalState; configuration: HemorrhageConfiguration;
  outputs: ProcessOutput; nextTick: number; parentProcessId?: string; parentProcessType?: string;
};
export type HemorrhageProcessEvent = { eventType: "HemorrhageStarted" | "HemorrhageReduced" | "HemorrhageStopped" | "PerfusionChanged" | "CompensationChanged"; details: Record<string, unknown> };
