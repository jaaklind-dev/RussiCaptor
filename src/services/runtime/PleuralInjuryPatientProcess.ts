import type { PleuralInjuryConfiguration, PleuralInjuryPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

export const defaultPleuralInjuryConfiguration: PleuralInjuryConfiguration = Object.freeze({
  version: "WP-44/V1",
  initialAirBurden: 35,
  initialBloodBurdenMl: 450,
  airAccumulationPerMin: 4,
  bloodAccumulationPerMin: 120,
  drainedAirReduction: 45,
  drainedBloodReductionMl: 500,
  drainageAirAccumulationMultiplier: 0.2,
  maximumBloodBurdenMl: 3000,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function assertExtendedConfiguration(configuration: PleuralInjuryConfiguration): void {
  for (const [field, value] of [
    ["initialDrainageVolumeMl", configuration.initialDrainageVolumeMl],
    ["ongoingDrainOutputRateMlMin", configuration.ongoingDrainOutputRateMlMin],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Pleural configuration ${field} peab olema mittenegatiivne lõplik arv.`);
  }
  const recovery = configuration.postDrainRespiratoryRecovery;
  if (recovery && Object.values(recovery).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Pleural respiratory recovery configuration peab sisaldama mittenegatiivseid lõplikke arve.");
}

function output(process: Omit<PleuralInjuryPatientProcessRuntime, "outputs">): ProcessOutput {
  const state = process.clinicalState;
  const airSeverity = state.airBurden / 100;
  const bloodSeverity = state.bloodBurdenMl / process.configuration.maximumBloodBurdenMl;
  return {
    processId: process.processId,
    encounterId: process.encounterId,
    moduleId: "PLEURAL_INJURY_V1",
    status: process.state,
    globalSeverityScore: clamp(Math.max(airSeverity, bloodSeverity), 0, 1),
    visibleFindings: [{ code: "MASSIVE_HEMOPNEUMOTHORAX", location: "THORAX", severity: Math.round(Math.max(airSeverity, bloodSeverity) * 100), visible: true, sourceProcessId: process.processId }],
    runtimeContributions: {
      pleuralAirBurden: state.airBurden,
      pleuralBloodBurdenMl: state.bloodBurdenMl,
      pleuralDrainageActive: state.drainageActive,
      respiratoryImpairmentMultiplier: 1 + Math.max(airSeverity, bloodSeverity),
      ...(state.initialDrainageCompleted !== undefined ? {
        pleuralInitialDrainageCompleted: state.initialDrainageCompleted,
        pleuralInitialDrainageVolumeMl: state.initialDrainageVolumeMl,
        pleuralOngoingDrainOutputMl: state.ongoingDrainOutputMl,
        pleuralOngoingDrainRateMlMin: state.ongoingDrainRateMlMin,
        pleuralTotalDrainOutputMl: state.totalDrainOutputMl,
        pleuralDrainageCompletedAtSec: state.drainageCompletedAtSec,
      } : {}),
    },
    observedAtSec: process.elapsedTime,
  };
}

export function bootstrapPleuralInjuryPatientProcess(encounterId: string, input: Record<string, unknown>): PleuralInjuryPatientProcessRuntime {
  const configuration = { ...defaultPleuralInjuryConfiguration, ...(input.configuration as Partial<PleuralInjuryConfiguration> | undefined) };
  assertExtendedConfiguration(configuration);
  const extendedDrainage = configuration.initialDrainageVolumeMl !== undefined || configuration.ongoingDrainOutputRateMlMin !== undefined;
  const processWithoutOutput: Omit<PleuralInjuryPatientProcessRuntime, "outputs"> = {
    processId: String(input.processId ?? `${encounterId}:PLEURAL_INJURY:1`),
    encounterId,
    instanceKey: String(input.instanceKey ?? `${encounterId}:pleural:1`),
    processType: "PLEURAL_INJURY",
    templateId: String(input.templateId ?? "MASSIVE_HEMOPNEUMOTHORAX_V1"),
    state: "Active",
    elapsedTime: 0,
    clinicalState: {
      airBurden: Number(input.airBurden ?? configuration.initialAirBurden),
      bloodBurdenMl: Number(input.bloodBurdenMl ?? configuration.initialBloodBurdenMl),
      drainageActive: false,
      drainedAir: 0,
      drainedBloodMl: 0,
      ...(extendedDrainage ? {
        initialDrainageCompleted: false,
        initialDrainageVolumeMl: 0,
        ongoingDrainOutputMl: 0,
        totalDrainOutputMl: 0,
        ongoingDrainRateMlMin: configuration.ongoingDrainOutputRateMlMin ?? 0,
      } : {}),
      appliedEffectIds: [],
      oxygenTherapyActive: false,
    },
    configuration,
    nextTick: 60,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function applyPleuralEffects(previous: PleuralInjuryPatientProcessRuntime, effects: readonly ClinicalEffect[]): PleuralInjuryPatientProcessRuntime {
  let state = { ...previous.clinicalState, appliedEffectIds: [...previous.clinicalState.appliedEffectIds] };
  for (const effect of [...effects].sort((a, b) => a.timestamp - b.timestamp || a.effectId.localeCompare(b.effectId))) {
    if (effect.effectType !== "PLEURAL_DRAINAGE" || state.appliedEffectIds.includes(effect.effectId)) continue;
    const extendedDrainage = previous.configuration.initialDrainageVolumeMl !== undefined || previous.configuration.ongoingDrainOutputRateMlMin !== undefined;
    if (extendedDrainage && state.initialDrainageCompleted) {
      continue;
    }
    const configuredInitialDrainage = previous.configuration.initialDrainageVolumeMl ?? previous.configuration.drainedBloodReductionMl;
    const initialDrainage = Math.min(state.bloodBurdenMl, configuredInitialDrainage);
    state = {
      ...state,
      drainageActive: true,
      airBurden: clamp(state.airBurden - previous.configuration.drainedAirReduction, 0, 100),
      bloodBurdenMl: clamp(state.bloodBurdenMl - configuredInitialDrainage, 0, previous.configuration.maximumBloodBurdenMl),
      drainedAir: state.drainedAir + Math.min(state.airBurden, previous.configuration.drainedAirReduction),
      drainedBloodMl: state.drainedBloodMl + initialDrainage,
      ...(extendedDrainage ? {
        initialDrainageCompleted: true,
        initialDrainageVolumeMl: initialDrainage,
        ongoingDrainOutputMl: state.ongoingDrainOutputMl ?? 0,
        totalDrainOutputMl: initialDrainage + (state.ongoingDrainOutputMl ?? 0),
        ongoingDrainRateMlMin: previous.configuration.ongoingDrainOutputRateMlMin ?? 0,
        drainageCompletedAtSec: effect.timestamp,
      } : {}),
      appliedEffectIds: [...state.appliedEffectIds, effect.effectId].sort(),
    };
  }
  const processWithoutOutput = { ...previous, clinicalState: state, state: state.drainageActive ? "Controlled" as const : previous.state };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function tickPleuralInjuryPatientProcess(previous: PleuralInjuryPatientProcessRuntime, tickSeconds: number): PleuralInjuryPatientProcessRuntime {
  const minutes = tickSeconds / 60;
  const airRate = previous.configuration.airAccumulationPerMin * (previous.clinicalState.drainageActive ? previous.configuration.drainageAirAccumulationMultiplier : 1);
  const extendedDrainage = previous.configuration.initialDrainageVolumeMl !== undefined || previous.configuration.ongoingDrainOutputRateMlMin !== undefined;
  const ongoingDrainIncrement = previous.clinicalState.drainageActive && extendedDrainage
    ? (previous.configuration.ongoingDrainOutputRateMlMin ?? 0) * minutes
    : 0;
  const ongoingDrainOutputMl = (previous.clinicalState.ongoingDrainOutputMl ?? 0) + ongoingDrainIncrement;
  const clinicalState = {
    ...previous.clinicalState,
    airBurden: clamp(previous.clinicalState.airBurden + airRate * minutes, 0, 100),
    bloodBurdenMl: clamp(previous.clinicalState.bloodBurdenMl + (previous.clinicalState.drainageActive && extendedDrainage ? 0 : previous.configuration.bloodAccumulationPerMin * minutes), 0, previous.configuration.maximumBloodBurdenMl),
    ...(extendedDrainage ? {
      ongoingDrainOutputMl,
      totalDrainOutputMl: (previous.clinicalState.initialDrainageVolumeMl ?? 0) + ongoingDrainOutputMl,
      ongoingDrainRateMlMin: previous.configuration.ongoingDrainOutputRateMlMin ?? 0,
    } : {}),
  };
  const processWithoutOutput = { ...previous, clinicalState, elapsedTime: previous.elapsedTime + tickSeconds, nextTick: previous.nextTick + tickSeconds };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}
