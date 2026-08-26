import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

export type HemorrhageSeverity = "NONE" | "MINOR" | "MODERATE" | "SEVERE" | "CATASTROPHIC";
export type PerfusionState = "NORMAL" | "COMPENSATED" | "DECOMPENSATED" | "CRITICAL";
export type CompensationState = "COMPENSATED" | "FAILING" | "FAILED";
export type PressureDependentHemorrhageFlowConfiguration = Readonly<{
  /** Piecewise-linear SBP anchors; interpolation is continuous and deterministic. */
  sbpAnchors?: readonly Readonly<{ sbpMmHg: number; factor: number }>[];
  /** Read compatibility only for the unversioned WP-48A prototype checkpoint. */
  fullFlowMapMmHg?: number;
  floorMapMmHg?: number;
  minimumFlowFraction?: number;
}>;
export const PRESSURE_DEPENDENT_HEMORRHAGE_FLOW_V1: PressureDependentHemorrhageFlowConfiguration = Object.freeze({
  sbpAnchors: Object.freeze([
    Object.freeze({ sbpMmHg: 30, factor: 0.3 }), Object.freeze({ sbpMmHg: 40, factor: 0.3 }),
    Object.freeze({ sbpMmHg: 50, factor: 0.55 }), Object.freeze({ sbpMmHg: 60, factor: 0.55 }),
    Object.freeze({ sbpMmHg: 70, factor: 0.8 }), Object.freeze({ sbpMmHg: 80, factor: 0.8 }),
    Object.freeze({ sbpMmHg: 90, factor: 1 }), Object.freeze({ sbpMmHg: 100, factor: 1 }),
  ]),
});
export type PelvicStabilizationState = "NONE" | "INCORRECT" | "CORRECT" | "LOOSENED";
export type PelvicSourceControlConfiguration = Readonly<{
  openRateMlMin: number;
  incorrectRateMlMin: number;
  loosenedRateMlMin: number;
  correctMaturation: readonly Readonly<{ afterSec: number; rateMlMin: number }>[];
}>;
export type HemorrhageCoagulationConfiguration = Readonly<{
  temperatureModifiers?: readonly Readonly<{ belowCelsius: number; factor: number }>[];
}>;
export type HemorrhageConfiguration = {
  baselineBleedingRateMlMin: number;
  /** Optional thoracic rate used while a canonical pleural drain is active. */
  bleedingRateAfterPleuralDrainageMlMin?: number;
  tourniquetEfficiency: number;
  binderEfficiency: number;
  infusionOffsetMlMin: number;
  bloodProductOffsetMlMin: number;
  /** Opt-in/versioned pressure-dependent source-flow modulation. */
  pressureDependentFlow?: PressureDependentHemorrhageFlowConfiguration;
  pelvicSourceControl?: PelvicSourceControlConfiguration;
  coagulation?: HemorrhageCoagulationConfiguration;
  severityThresholdsMl: readonly [number, number, number, number];
  perfusionThresholdsMl: readonly [number, number, number];
  compensationThresholdsMl: readonly [number, number];
  trendThresholdsMlMin: Readonly<{ worsening: number; improving: number }>;
  vitalResponsePer1000Ml?: Readonly<{
    heartRateDelta?: number;
    systolicBpDelta?: number;
    diastolicBpDelta?: number;
    crtDelta?: number;
  }>;
};
export type HemorrhageClinicalState = {
  estimatedBloodLossMl: number;
  cumulativeLossMl: number;
  bleedingRateMlMin: number;
  baseSourceRateMlMin?: number;
  pressureFactor?: number;
  interventionFactor?: number;
  sourceControlCeilingMlMin?: number;
  pelvicStabilizationState?: PelvicStabilizationState;
  correctStabilizationStartedAtSec?: number;
  timeSinceCorrectStabilizationSec?: number;
  coagulationFactor?: number;
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
  sourceId?: string;
  sourceType?: string;
};
export type HemorrhageProcessEvent = { eventType: "HemorrhageStarted" | "HemorrhageReduced" | "HemorrhageStopped" | "PerfusionChanged" | "CompensationChanged"; details: Record<string, unknown> };
