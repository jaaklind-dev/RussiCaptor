import type { GoldenFixture } from "@/models/GoldenTest";
import type {
  RespiratoryFailureConfiguration,
  RespiratoryFailurePatientProcessRuntime,
  RespiratoryFailurePhenotype,
  PleuralRespiratoryRecoveryConfiguration,
} from "@/models/PatientProcessRuntime";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const moduleId = "RESPIRATORY_FAILURE_V1";

export const defaultRespiratoryFailureConfiguration: RespiratoryFailureConfiguration = {
  version: "WP-17/V1",
  initial: {
    spo2: 94,
    respiratoryRate: 20,
    etco2: 40,
    gcs: 15,
    workOfBreathing: 10,
    fatigue: 0,
  },
  progression: {
    spo2DeclinePerMin: 1.5,
    respiratoryRateChangePerMin: 1,
    etco2RisePerMin: 2,
    workOfBreathingRisePerMin: 4,
    fatigueRisePerMin: 3,
    gcsDeclinePerMin: 0.25,
  },
  support: {
    oxygenSpo2RecoveryPerMin: 3,
    patentAirwayWorkRecoveryPerMin: 2,
    bvmSpo2RecoveryPerMin: 4,
    bvmEtco2ClearancePerMin: 5,
    bvmFatigueRecoveryPerMin: 4,
    mechanicalSpo2RecoveryPerMin: 5,
    mechanicalEtco2ClearancePerMin: 6,
    mechanicalFatigueRecoveryPerMin: 6,
  },
  limits: {
    spo2: { min: 40, max: 100 },
    respiratoryRate: { min: 0, max: 60 },
    etco2: { min: 0, max: 150 },
    gcs: { min: 3, max: 15 },
    workOfBreathing: { min: 0, max: 100 },
    fatigue: { min: 0, max: 100 },
  },
  recovery: { resolvedFatigueMax: 5, resolvedWorkOfBreathingMax: 5 },
};

export type RespiratoryFailureClinicalEffect =
  | { effectType: "INSPIRED_OXYGEN_INCREASED" | "INSPIRED_OXYGEN_REMOVED" | "UPPER_AIRWAY_PATENCY" | "AIRWAY_PROTECTED" }
  | { effectType: "EFFECTIVE_VENTILATION"; mode: "BVM" | "MECHANICAL" };

const clamp = (value: number, limits: { min: number; max: number }) =>
  Math.min(limits.max, Math.max(limits.min, value));
const round = (value: number) => Number(value.toFixed(3));

function phenotype(value: unknown): RespiratoryFailurePhenotype {
  const normalized = String(value ?? "MIXED").toUpperCase();
  if (normalized === "HYPOXAEMIC" || normalized === "HYPERCAPNIC" || normalized === "MIXED") return normalized;
  throw new Error(`Respiratory failure phenotype ${normalized} pole toetatud.`);
}

function configured(
  defaults: RespiratoryFailureConfiguration,
  override?: Partial<RespiratoryFailureConfiguration>
): RespiratoryFailureConfiguration {
  return {
    ...defaults,
    ...override,
    initial: { ...defaults.initial, ...override?.initial },
    progression: { ...defaults.progression, ...override?.progression },
    support: { ...defaults.support, ...override?.support },
    limits: {
      ...defaults.limits,
      ...override?.limits,
      spo2: { ...defaults.limits.spo2, ...override?.limits?.spo2 },
      respiratoryRate: { ...defaults.limits.respiratoryRate, ...override?.limits?.respiratoryRate },
      etco2: { ...defaults.limits.etco2, ...override?.limits?.etco2 },
      gcs: { ...defaults.limits.gcs, ...override?.limits?.gcs },
      workOfBreathing: { ...defaults.limits.workOfBreathing, ...override?.limits?.workOfBreathing },
      fatigue: { ...defaults.limits.fatigue, ...override?.limits?.fatigue },
    },
    recovery: { ...defaults.recovery, ...override?.recovery },
  };
}

function output(process: Omit<RespiratoryFailurePatientProcessRuntime, "outputs">): ProcessOutput {
  const clinical = process.clinicalState;
  return {
    processId: process.processId,
    encounterId: process.encounterId,
    moduleId,
    status: process.state,
    globalSeverityScore: Math.max(
      clinical.fatigue / process.configuration.limits.fatigue.max,
      clinical.workOfBreathing / process.configuration.limits.workOfBreathing.max,
      (process.configuration.limits.spo2.max - clinical.spo2) /
        (process.configuration.limits.spo2.max - process.configuration.limits.spo2.min)
    ),
    respiratoryPriority: 100,
    oxygenationPriority: 100,
    neurologicPriority: 100,
    vitalContributions: [
      ...(process.configuration.spo2ContributorEnabled === false ? [] : [{ vital: "spo2" as const, operation: "TARGET" as const, value: clinical.spo2 }]),
      { vital: "respiratoryRate", operation: "TARGET", value: clinical.respiratoryRate },
      { vital: "etco2", operation: "TARGET", value: clinical.etco2 },
      { vital: "gcs", operation: "TARGET", value: clinical.gcs },
    ],
    runtimeContributions: {
      respiratoryFailurePhenotype: clinical.phenotype,
      workOfBreathing: clinical.workOfBreathing,
      respiratoryFatigue: clinical.fatigue,
      oxygenSupport: clinical.oxygenSupport,
      respiratoryAirwayPatent: clinical.airwayPatent,
      respiratoryAirwayProtected: clinical.airwayProtected,
      ventilationMode: clinical.ventilationMode,
      respiratoryFailureTrend: clinical.trend,
    },
    observedAtSec: process.elapsedTime,
  };
}

export function bootstrapRespiratoryFailurePatientProcess(
  fixture: Pick<GoldenFixture, "fixtureId" | "patientId">,
  initial: Record<string, unknown>,
  configuration?: Partial<RespiratoryFailureConfiguration>
): RespiratoryFailurePatientProcessRuntime {
  const config = configured(defaultRespiratoryFailureConfiguration, configuration);
  const processId = String(initial.processId ?? initial.templateId ?? fixture.fixtureId.replace(/^FX-/, ""));
  const processWithoutOutput: Omit<RespiratoryFailurePatientProcessRuntime, "outputs"> = {
    processId,
    encounterId: fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`,
    instanceKey: String(initial.instanceKey ?? `${processId}:primary`),
    processType: "RESPIRATORY_FAILURE",
    templateId: String(initial.templateId ?? "RESPIRATORY_FAILURE_V1"),
    state: "Active",
    elapsedTime: 0,
    clinicalState: {
      phenotype: phenotype(initial.phenotype),
      spo2: clamp(Number(initial.spo2 ?? config.initial.spo2), config.limits.spo2),
      respiratoryRate: clamp(Number(initial.respiratoryRate ?? config.initial.respiratoryRate), config.limits.respiratoryRate),
      etco2: clamp(Number(initial.etco2 ?? config.initial.etco2), config.limits.etco2),
      gcs: clamp(Number(initial.gcs ?? config.initial.gcs), config.limits.gcs),
      workOfBreathing: clamp(Number(initial.workOfBreathing ?? config.initial.workOfBreathing), config.limits.workOfBreathing),
      fatigue: clamp(Number(initial.fatigue ?? config.initial.fatigue), config.limits.fatigue),
      oxygenSupport: false,
      oxygenTherapyActive: false,
      airwayPatent: Boolean(initial.airwayPatent ?? true),
      airwayProtected: Boolean(initial.airwayProtected),
      ventilationMode: "NONE",
      trend: "STABLE",
    },
    configuration: config,
    nextTick: Number(initial.nextTick ?? 60),
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function applyRespiratoryFailureClinicalEffect(
  previous: RespiratoryFailurePatientProcessRuntime,
  effect: RespiratoryFailureClinicalEffect
): RespiratoryFailurePatientProcessRuntime {
  const clinicalState = { ...previous.clinicalState };
  if (effect.effectType === "INSPIRED_OXYGEN_INCREASED") {
    clinicalState.oxygenSupport = true;
    clinicalState.oxygenTherapyActive = true;
  }
  if (effect.effectType === "INSPIRED_OXYGEN_REMOVED") {
    clinicalState.oxygenSupport = false;
    clinicalState.oxygenTherapyActive = false;
  }
  if (effect.effectType === "UPPER_AIRWAY_PATENCY") clinicalState.airwayPatent = true;
  if (effect.effectType === "AIRWAY_PROTECTED") clinicalState.airwayProtected = true;
  if (effect.effectType === "EFFECTIVE_VENTILATION") clinicalState.ventilationMode = effect.mode;
  const processWithoutOutput = { ...previous, clinicalState };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function tickRespiratoryFailurePatientProcess(
  previous: RespiratoryFailurePatientProcessRuntime,
  tickSeconds: number,
  impairmentMultiplier = 1,
  pleuralRecovery?: PleuralRespiratoryRecoveryConfiguration
): RespiratoryFailurePatientProcessRuntime {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) throw new Error("ENGINE_TICK kestus peab olema positiivne arv sekundeid.");
  if (previous.state === "Resolved") return previous;
  const minutes = tickSeconds / 60;
  const { progression, support, limits, recovery } = previous.configuration;
  const clinical = previous.clinicalState;
  const hypoxaemic = clinical.phenotype !== "HYPERCAPNIC";
  const hypercapnic = clinical.phenotype !== "HYPOXAEMIC";
  const ventilationSpo2 = clinical.ventilationMode === "MECHANICAL"
    ? support.mechanicalSpo2RecoveryPerMin
    : clinical.ventilationMode === "BVM" ? support.bvmSpo2RecoveryPerMin : 0;
  const ventilationCo2 = clinical.ventilationMode === "MECHANICAL"
    ? support.mechanicalEtco2ClearancePerMin
    : clinical.ventilationMode === "BVM" ? support.bvmEtco2ClearancePerMin : 0;
  const fatigueRecovery = clinical.ventilationMode === "MECHANICAL"
    ? support.mechanicalFatigueRecoveryPerMin
    : clinical.ventilationMode === "BVM" ? support.bvmFatigueRecoveryPerMin : 0;
  const supported = clinical.oxygenSupport || clinical.ventilationMode !== "NONE";
  const impairment = Math.max(0, impairmentMultiplier);
  const respiratorySpo2Recovery = pleuralRecovery?.spo2RecoveryPerMin ?? 0;
  const unboundedSpo2 = clinical.spo2 + ((clinical.oxygenSupport ? support.oxygenSpo2RecoveryPerMin : 0) + ventilationSpo2 + respiratorySpo2Recovery - (hypoxaemic ? progression.spo2DeclinePerMin * impairment : 0)) * minutes;
  const spo2 = clamp(pleuralRecovery ? Math.min(pleuralRecovery.spo2Ceiling, unboundedSpo2) : unboundedSpo2, limits.spo2);
  const etco2 = clamp(clinical.etco2 + ((hypercapnic ? progression.etco2RisePerMin * impairment : 0) - ventilationCo2) * minutes, limits.etco2);
  const fatigue = clamp(pleuralRecovery
    ? Math.max(pleuralRecovery.fatigueFloor, clinical.fatigue + (progression.fatigueRisePerMin * impairment - fatigueRecovery - pleuralRecovery.fatigueRecoveryPerMin) * minutes)
    : clinical.fatigue + (progression.fatigueRisePerMin * impairment - fatigueRecovery) * minutes, limits.fatigue);
  const workOfBreathing = clamp(pleuralRecovery
    ? Math.max(pleuralRecovery.workOfBreathingFloor, clinical.workOfBreathing + (progression.workOfBreathingRisePerMin * impairment - (clinical.airwayPatent ? support.patentAirwayWorkRecoveryPerMin : 0) - fatigueRecovery - pleuralRecovery.workOfBreathingRecoveryPerMin) * minutes)
    : clinical.workOfBreathing + (progression.workOfBreathingRisePerMin * impairment - (clinical.airwayPatent ? support.patentAirwayWorkRecoveryPerMin : 0) - fatigueRecovery) * minutes, limits.workOfBreathing);
  const respiratoryRateDirection = clinical.ventilationMode === "NONE" ? progression.respiratoryRateChangePerMin * impairment : -progression.respiratoryRateChangePerMin;
  const unboundedRespiratoryRate = clinical.respiratoryRate + (respiratoryRateDirection - (pleuralRecovery?.respiratoryRateRecoveryPerMin ?? 0)) * minutes;
  const respiratoryRate = clamp(pleuralRecovery ? Math.max(pleuralRecovery.respiratoryRateFloor, unboundedRespiratoryRate) : unboundedRespiratoryRate, limits.respiratoryRate);
  const deteriorating = (!supported && hypoxaemic) || (hypercapnic && ventilationCo2 === 0);
  const gcs = clamp(clinical.gcs + (deteriorating ? -progression.gcsDeclinePerMin : progression.gcsDeclinePerMin) * minutes, limits.gcs);
  const scoreBefore = clinical.spo2 - clinical.etco2 - clinical.fatigue - clinical.workOfBreathing;
  const scoreAfter = spo2 - etco2 - fatigue - workOfBreathing;
  const nextClinical = {
    ...clinical, spo2: round(spo2), respiratoryRate: round(respiratoryRate), etco2: round(etco2),
    gcs: round(gcs), workOfBreathing: round(workOfBreathing), fatigue: round(fatigue),
    trend: scoreAfter > scoreBefore ? "IMPROVING" as const : scoreAfter < scoreBefore ? "WORSENING" as const : "STABLE" as const,
  };
  const state = supported && nextClinical.fatigue <= recovery.resolvedFatigueMax && nextClinical.workOfBreathing <= recovery.resolvedWorkOfBreathingMax
    ? "Resolved" as const : supported ? "Controlled" as const : "Active" as const;
  const processWithoutOutput = {
    ...previous, state, clinicalState: nextClinical,
    elapsedTime: previous.elapsedTime + tickSeconds,
    nextTick: previous.nextTick + tickSeconds,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}
