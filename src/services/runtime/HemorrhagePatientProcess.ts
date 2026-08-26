import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { HemorrhageConfiguration, HemorrhagePatientProcessRuntime, HemorrhageProcessEvent, PelvicStabilizationState } from "@/models/HemorrhagePatientProcess";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const moduleId = "HEMORRHAGE_V1";
function validConfig(value: unknown): value is HemorrhageConfiguration {
  if (!value || typeof value !== "object") return false;
  const c = value as HemorrhageConfiguration;
  return [c.baselineBleedingRateMlMin, c.tourniquetEfficiency, c.binderEfficiency,
    c.infusionOffsetMlMin, c.bloodProductOffsetMlMin].every(Number.isFinite) &&
    (c.bleedingRateAfterPleuralDrainageMlMin === undefined || (Number.isFinite(c.bleedingRateAfterPleuralDrainageMlMin) && c.bleedingRateAfterPleuralDrainageMlMin >= 0)) &&
    c.severityThresholdsMl?.length === 4 && c.perfusionThresholdsMl?.length === 3 &&
    c.compensationThresholdsMl?.length === 2 && Boolean(c.trendThresholdsMlMin) &&
    (c.pressureDependentFlow === undefined || (c.pressureDependentFlow.sbpAnchors !== undefined && validAnchors(c.pressureDependentFlow.sbpAnchors)) ||
      [c.pressureDependentFlow.fullFlowMapMmHg, c.pressureDependentFlow.floorMapMmHg,
        c.pressureDependentFlow.minimumFlowFraction].every(Number.isFinite)) &&
    (c.pelvicSourceControl === undefined || validPelvicControl(c.pelvicSourceControl)) &&
    (c.coagulation?.temperatureModifiers === undefined || validTemperatureModifiers(c.coagulation.temperatureModifiers));
}
function validAnchors(anchors: readonly Readonly<{ sbpMmHg: number; factor: number }>[]): boolean {
  return anchors.length >= 2 && anchors.every((anchor, index) => Number.isFinite(anchor.sbpMmHg) &&
    Number.isFinite(anchor.factor) && anchor.factor >= 0 && anchor.factor <= 1 &&
    (index === 0 || anchor.sbpMmHg > anchors[index - 1].sbpMmHg));
}
function validPelvicControl(value: NonNullable<HemorrhageConfiguration["pelvicSourceControl"]>): boolean {
  return [value.openRateMlMin, value.incorrectRateMlMin, value.loosenedRateMlMin].every(rate => Number.isFinite(rate) && rate >= 0) &&
    value.correctMaturation.length > 0 && value.correctMaturation.every((stage, index) => Number.isFinite(stage.afterSec) &&
      stage.afterSec >= 0 && Number.isFinite(stage.rateMlMin) && stage.rateMlMin >= 0 &&
      (index === 0 || stage.afterSec > value.correctMaturation[index - 1].afterSec));
}
function validTemperatureModifiers(values: readonly Readonly<{ belowCelsius: number; factor: number }>[]): boolean {
  return values.every(item => Number.isFinite(item.belowCelsius) && Number.isFinite(item.factor) && item.factor >= 1);
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
  const priorState = previous.clinicalState.pelvicStabilizationState ?? "NONE";
  const pelvicEffect = activeEffects.find(effect => effect.effectType === "PELVIC_STABILIZATION");
  const requestedState: PelvicStabilizationState = pelvicEffect?.parameters.position === "INCORRECT" ? "INCORRECT"
    : pelvicEffect?.parameters.position === "LOOSENED" ? "LOOSENED" : pelvicEffect ? "CORRECT" : "NONE";
  const correctStartedAt = requestedState === "CORRECT"
    ? (priorState === "CORRECT" ? previous.clinicalState.correctStabilizationStartedAtSec : pelvicEffect?.timestamp ?? previous.elapsedTime)
    : undefined;
  const controlState = previous.configuration.pelvicSourceControl ? {
    pelvicStabilizationState: requestedState, correctStabilizationStartedAtSec: correctStartedAt,
  } : {};
  const base = { ...structuredClone(previous), clinicalState: { ...structuredClone(previous.clinicalState), activeEffects, resolvedEffectIds, ...controlState } };
  return { ...base, outputs: output(base) };
}
function band(value: number, t: readonly number[]): number { return t.filter(x => value >= x).length; }
function precise(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
export function pressureDependentHemorrhageFactor(configuration: HemorrhageConfiguration, sbpMmHg?: number): number {
  const pressure = configuration.pressureDependentFlow;
  if (!pressure || sbpMmHg === undefined || !Number.isFinite(sbpMmHg)) return 1;
  const anchors = pressure.sbpAnchors;
  // Old unversioned WP-48A prototype checkpoints carried MAP fields. They remain readable,
  // but do not silently impose obsolete MAP semantics on the revised SBP model.
  if (!anchors?.length) return 1;
  if (sbpMmHg <= anchors[0].sbpMmHg) return anchors[0].factor;
  if (sbpMmHg >= anchors[anchors.length - 1].sbpMmHg) return anchors[anchors.length - 1].factor;
  const upperIndex = anchors.findIndex(anchor => anchor.sbpMmHg >= sbpMmHg);
  const lower = anchors[upperIndex - 1]; const upper = anchors[upperIndex];
  const fraction = (sbpMmHg - lower.sbpMmHg) / (upper.sbpMmHg - lower.sbpMmHg);
  // Smooth interpolation retains the exact configured anchors without discontinuous bands.
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return precise(lower.factor + (upper.factor - lower.factor) * smooth);
}
function pelvicSourceRate(previous: HemorrhagePatientProcessRuntime): { rate: number; sinceCorrect?: number } {
  const pelvic = previous.configuration.pelvicSourceControl;
  if (!pelvic) return { rate: previous.configuration.baselineBleedingRateMlMin };
  const state = previous.clinicalState.pelvicStabilizationState ?? "NONE";
  if (state === "INCORRECT") return { rate: pelvic.incorrectRateMlMin };
  if (state === "LOOSENED") return { rate: pelvic.loosenedRateMlMin };
  if (state !== "CORRECT") return { rate: pelvic.openRateMlMin };
  const sinceCorrect = Math.max(0, previous.elapsedTime - (previous.clinicalState.correctStabilizationStartedAtSec ?? previous.elapsedTime));
  const stage = [...pelvic.correctMaturation].reverse().find(item => sinceCorrect >= item.afterSec) ?? pelvic.correctMaturation[0];
  return { rate: stage.rateMlMin, sinceCorrect };
}
function coagulationFactor(configuration: HemorrhageConfiguration, temperatureCelsius?: number): number {
  if (!configuration.coagulation?.temperatureModifiers || temperatureCelsius === undefined || !Number.isFinite(temperatureCelsius)) return 1;
  return precise(configuration.coagulation.temperatureModifiers.reduce((factor, item) =>
    temperatureCelsius < item.belowCelsius ? Math.max(factor, item.factor) : factor, 1));
}
export function tickHemorrhagePatientProcess(previous: HemorrhagePatientProcessRuntime, seconds: number, sbpMmHg?: number, temperatureCelsius?: number): { process: HemorrhagePatientProcessRuntime; events: HemorrhageProcessEvent[] } {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Hemorrhage tick duration is invalid.");
  const c = previous.configuration; const effects = previous.clinicalState.activeEffects;
  const stopped = effects.some(e => e.effectType === "STOP_EXTERNAL_BLEEDING");
  const reduction = Math.max(0, ...effects.map(e => e.effectType === "REDUCE_EXTERNAL_BLEEDING" ? c.tourniquetEfficiency : e.effectType === "PELVIC_STABILIZATION" && !c.pelvicSourceControl ? c.binderEfficiency : 0));
  const support = effects.reduce((sum, e) => sum + (e.effectType === "BLOOD_PRODUCT_STARTED" ? c.bloodProductOffsetMlMin : e.effectType === "INFUSION_RUNNING" ? c.infusionOffsetMlMin : 0), 0);
  const pleuralDrainageActive = previous.sourceType === "THORACIC" && effects.some(e => e.effectType === "PLEURAL_DRAINAGE");
  const pelvic = pelvicSourceRate(previous);
  const untreatedRate = pleuralDrainageActive && c.bleedingRateAfterPleuralDrainageMlMin !== undefined
    ? c.bleedingRateAfterPleuralDrainageMlMin
    : previous.sourceType === "PELVIC" ? pelvic.rate : c.baselineBleedingRateMlMin;
  const pressureFactor = pressureDependentHemorrhageFactor(c, sbpMmHg);
  const coagulation = coagulationFactor(c, temperatureCelsius);
  const interventionFactor = precise(1 - reduction);
  const rate = precise(stopped ? 0 : Math.max(0, untreatedRate * pressureFactor * coagulation * interventionFactor - support));
  const cumulative = precise(previous.clinicalState.cumulativeLossMl + rate * seconds / 60);
  if (!Number.isFinite(cumulative) || cumulative < previous.clinicalState.cumulativeLossMl) {
    throw new Error("Hemorrhage cumulative loss is invalid.");
  }
  const severities = ["NONE", "MINOR", "MODERATE", "SEVERE", "CATASTROPHIC"] as const;
  const perfusions = ["NORMAL", "COMPENSATED", "DECOMPENSATED", "CRITICAL"] as const;
  const compensations = ["COMPENSATED", "FAILING", "FAILED"] as const;
  const severity = severities[band(cumulative, c.severityThresholdsMl)];
  const perfusion = perfusions[band(cumulative, c.perfusionThresholdsMl)];
  const compensation = compensations[band(cumulative, c.compensationThresholdsMl)];
  const worsening = rate >= c.trendThresholdsMlMin.worsening; const improving = rate <= c.trendThresholdsMlMin.improving;
  const clinicalState = { ...previous.clinicalState, estimatedBloodLossMl: cumulative, cumulativeLossMl: cumulative,
    bleedingRateMlMin: rate, ...(c.pressureDependentFlow || c.pelvicSourceControl || c.coagulation ? {
      baseSourceRateMlMin: c.baselineBleedingRateMlMin, sourceControlCeilingMlMin: untreatedRate, pressureFactor,
      coagulationFactor: coagulation, interventionFactor,
      ...(pelvic.sinceCorrect !== undefined ? { timeSinceCorrectStabilizationSec: pelvic.sinceCorrect } : {}),
    } : {}),
    activeHemorrhage: rate > 0, severity, perfusion, compensation,
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

/** Finalizes circulation-driven bleeding when the canonical patient state becomes DEAD. */
export function terminateHemorrhageAtDeath(previous: HemorrhagePatientProcessRuntime): HemorrhagePatientProcessRuntime {
  if (!previous.clinicalState.activeHemorrhage && previous.clinicalState.bleedingRateMlMin === 0) return structuredClone(previous);
  const clinicalState = { ...structuredClone(previous.clinicalState), bleedingRateMlMin: 0, activeHemorrhage: false,
    heartRateTrend: "STABLE" as const, bloodPressureTrend: "STABLE" as const, perfusionTrend: "STABLE" as const };
  const withoutOutput = { ...structuredClone(previous), state: "Resolved" as const, clinicalState };
  return { ...withoutOutput, outputs: output(withoutOutput) };
}
