import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { HemorrhageConfiguration, HemorrhagePatientProcessRuntime, HemorrhageProcessEvent } from "@/models/HemorrhagePatientProcess";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const moduleId = "HEMORRHAGE_V1";
function validConfig(value: unknown): value is HemorrhageConfiguration {
  if (!value || typeof value !== "object") return false;
  const c = value as HemorrhageConfiguration;
  return [c.baselineBleedingRateMlMin, c.tourniquetEfficiency, c.binderEfficiency,
    c.infusionOffsetMlMin, c.bloodProductOffsetMlMin].every(Number.isFinite) &&
    (c.bleedingRateAfterPleuralDrainageMlMin === undefined || (Number.isFinite(c.bleedingRateAfterPleuralDrainageMlMin) && c.bleedingRateAfterPleuralDrainageMlMin >= 0)) &&
    c.severityThresholdsMl?.length === 4 && c.perfusionThresholdsMl?.length === 3 &&
    c.compensationThresholdsMl?.length === 2 && Boolean(c.trendThresholdsMlMin);
}
function output(p: Omit<HemorrhagePatientProcessRuntime, "outputs">): ProcessOutput {
  const response = p.configuration.vitalResponsePer1000Ml;
  const lossFactor = p.clinicalState.cumulativeLossMl / 1000;
  const vitalContributions = response ? [
    ["heartRate", response.heartRateDelta], ["systolicBp", response.systolicBpDelta],
    ["diastolicBp", response.diastolicBpDelta], ["crt", response.crtDelta],
  ].flatMap(([vital, delta]) => typeof delta === "number" ? [{ vital: vital as "heartRate" | "systolicBp" | "diastolicBp" | "crt", operation: "DELTA" as const, value: precise(delta * lossFactor) }] : []) : [];
  return { processId: p.processId, encounterId: p.encounterId, moduleId, status: p.state,
    globalSeverityScore: Math.min(1, p.clinicalState.cumulativeLossMl / p.configuration.severityThresholdsMl[3]),
    vitalContributions,
    runtimeContributions: { estimatedBloodLossMl: p.clinicalState.estimatedBloodLossMl,
      cumulativeBloodLossMl: p.clinicalState.cumulativeLossMl, bleedingRateMlMin: p.clinicalState.bleedingRateMlMin,
      hemorrhageSeverity: p.clinicalState.severity, perfusionState: p.clinicalState.perfusion,
      compensationState: p.clinicalState.compensation, HRTrend: p.clinicalState.heartRateTrend,
      BPTrend: p.clinicalState.bloodPressureTrend, PerfusionTrend: p.clinicalState.perfusionTrend },
    observedAtSec: p.elapsedTime };
}
export function bootstrapHemorrhagePatientProcess(encounterId: string, initial: Record<string, unknown>): HemorrhagePatientProcessRuntime {
  if (!validConfig(initial.configuration)) throw new Error("Hemorrhage configuration on puudulik.");
  const sourceId = initial.sourceId ? String(initial.sourceId) : undefined;
  const sourceType = initial.sourceType ? String(initial.sourceType) : undefined;
  const base: Omit<HemorrhagePatientProcessRuntime, "outputs"> = { processId: String(initial.processId ?? (sourceId ? `${encounterId}:HEMORRHAGE:${sourceId}` : `${encounterId}:HEMORRHAGE`)),
    encounterId, instanceKey: String(initial.instanceKey ?? (sourceId ? `${encounterId}:hemorrhage:${sourceId}` : `${encounterId}:hemorrhage`)), processType: "HEMORRHAGE",
    templateId: String(initial.templateId ?? "HEMORRHAGE_CONFIG"), state: "Active", elapsedTime: 0,
    configuration: structuredClone(initial.configuration), nextTick: 60, clinicalState: {
      estimatedBloodLossMl: Number(initial.estimatedBloodLossMl ?? 0), cumulativeLossMl: Number(initial.estimatedBloodLossMl ?? 0),
      bleedingRateMlMin: initial.configuration.baselineBleedingRateMlMin, activeHemorrhage: true, severity: "NONE",
      perfusion: "NORMAL", compensation: "COMPENSATED", heartRateTrend: "STABLE", bloodPressureTrend: "STABLE",
      perfusionTrend: "STABLE", activeEffects: [], resolvedEffectIds: [],
    }, ...(sourceId ? { sourceId } : {}), ...(sourceType ? { sourceType } : {}) };
  return { ...base, outputs: output(base) };
}
export function setHemorrhageEffects(previous: HemorrhagePatientProcessRuntime, effects: ClinicalEffect[]): HemorrhagePatientProcessRuntime {
  const applicableEffects = effects.filter(e => ["REDUCE_EXTERNAL_BLEEDING", "STOP_EXTERNAL_BLEEDING", "PELVIC_STABILIZATION", "INFUSION_RUNNING", "BLOOD_PRODUCT_STARTED"].includes(e.effectType) ||
    (e.effectType === "PLEURAL_DRAINAGE" && previous.configuration.bleedingRateAfterPleuralDrainageMlMin !== undefined))
    .filter(e => {
      const targetSourceId = typeof e.parameters.sourceId === "string" ? e.parameters.sourceId : undefined;
      if (targetSourceId && targetSourceId !== previous.sourceId) return false;
      if (e.effectType === "PELVIC_STABILIZATION" && previous.sourceType && previous.sourceType !== "PELVIC") return false;
      return true;
    });
  const activeEffects = [...new Map(applicableEffects.map(effect => [effect.effectId, effect])).values()]
    .sort((a, b) => a.effectType.localeCompare(b.effectType) || a.sourceInterventionInstanceId.localeCompare(b.sourceInterventionInstanceId));
  const resolvedEffectIds = activeEffects.map(e => e.effectId).sort();
  const base = { ...structuredClone(previous), clinicalState: { ...structuredClone(previous.clinicalState), activeEffects, resolvedEffectIds } };
  return { ...base, outputs: output(base) };
}
function band(value: number, t: readonly number[]): number { return t.filter(x => value >= x).length; }
function precise(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
export function tickHemorrhagePatientProcess(previous: HemorrhagePatientProcessRuntime, seconds: number): { process: HemorrhagePatientProcessRuntime; events: HemorrhageProcessEvent[] } {
  const c = previous.configuration; const effects = previous.clinicalState.activeEffects;
  const stopped = effects.some(e => e.effectType === "STOP_EXTERNAL_BLEEDING");
  const reduction = Math.max(0, ...effects.map(e => e.effectType === "REDUCE_EXTERNAL_BLEEDING" ? c.tourniquetEfficiency : e.effectType === "PELVIC_STABILIZATION" ? c.binderEfficiency : 0));
  const support = effects.reduce((sum, e) => sum + (e.effectType === "BLOOD_PRODUCT_STARTED" ? c.bloodProductOffsetMlMin : e.effectType === "INFUSION_RUNNING" ? c.infusionOffsetMlMin : 0), 0);
  const pleuralDrainageActive = previous.sourceType === "THORACIC" && effects.some(e => e.effectType === "PLEURAL_DRAINAGE");
  const untreatedRate = pleuralDrainageActive && c.bleedingRateAfterPleuralDrainageMlMin !== undefined
    ? c.bleedingRateAfterPleuralDrainageMlMin
    : c.baselineBleedingRateMlMin;
  const rate = precise(stopped ? 0 : Math.max(0, untreatedRate * (1 - reduction) - support));
  const cumulative = precise(previous.clinicalState.cumulativeLossMl + rate * seconds / 60);
  const severities = ["NONE", "MINOR", "MODERATE", "SEVERE", "CATASTROPHIC"] as const;
  const perfusions = ["NORMAL", "COMPENSATED", "DECOMPENSATED", "CRITICAL"] as const;
  const compensations = ["COMPENSATED", "FAILING", "FAILED"] as const;
  const severity = severities[band(cumulative, c.severityThresholdsMl)];
  const perfusion = perfusions[band(cumulative, c.perfusionThresholdsMl)];
  const compensation = compensations[band(cumulative, c.compensationThresholdsMl)];
  const worsening = rate >= c.trendThresholdsMlMin.worsening; const improving = rate <= c.trendThresholdsMlMin.improving;
  const clinicalState = { ...previous.clinicalState, estimatedBloodLossMl: cumulative, cumulativeLossMl: cumulative,
    bleedingRateMlMin: rate, activeHemorrhage: rate > 0, severity, perfusion, compensation,
    heartRateTrend: worsening ? "RISING" as const : improving ? "FALLING" as const : "STABLE" as const,
    bloodPressureTrend: worsening ? "FALLING" as const : improving ? "RISING" as const : "STABLE" as const,
    perfusionTrend: worsening ? "WORSENING" as const : improving ? "IMPROVING" as const : "STABLE" as const };
  const base = { ...structuredClone(previous), clinicalState, elapsedTime: previous.elapsedTime + seconds, nextTick: previous.nextTick + seconds };
  const process = { ...base, outputs: output(base) }; const events: HemorrhageProcessEvent[] = [];
  if (previous.elapsedTime === 0 && rate > 0) events.push({ eventType: "HemorrhageStarted", details: { rate } });
  if (rate < previous.clinicalState.bleedingRateMlMin) events.push({ eventType: rate === 0 ? "HemorrhageStopped" : "HemorrhageReduced", details: { from: previous.clinicalState.bleedingRateMlMin, to: rate } });
  if (perfusion !== previous.clinicalState.perfusion) events.push({ eventType: "PerfusionChanged", details: { from: previous.clinicalState.perfusion, to: perfusion } });
  if (compensation !== previous.clinicalState.compensation) events.push({ eventType: "CompensationChanged", details: { from: previous.clinicalState.compensation, to: compensation } });
  return { process, events };
}
