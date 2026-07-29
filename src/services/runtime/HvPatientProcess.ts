import type { GoldenFixture } from "@/models/GoldenTest";
import type { PatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const hvModuleId = "HYPOVENTILATION_HYPERCAPNIA_V1";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HV PatientProcess fixture InitialStateJSON peab olema objekt.");
  }
  return value as Record<string, unknown>;
}

function requiredNumber(source: Record<string, unknown>, field: string): number {
  const value = Number(source[field]);
  if (!Number.isFinite(value)) throw new Error(`HV PatientProcess fixture väli ${field} on vigane.`);
  return value;
}

function optionalNumber(source: Record<string, unknown>, field: string, fallback = 0): number {
  if (source[field] === undefined || source[field] === null || source[field] === "") return fallback;
  return requiredNumber(source, field);
}

function output(process: Omit<PatientProcessRuntime, "outputs">): ProcessOutput {
  const clinical = process.clinicalState;
  return {
    processId: process.processId,
    encounterId: process.encounterId,
    moduleId: hvModuleId,
    status: process.state,
    globalSeverityScore: Math.min(1, Math.max(0, clinical.co2Burden / 100)),
    respiratoryPriority: 100,
    runtimeContributions: {
      ventilationReserve: clinical.ventilationReserve,
      co2Burden: clinical.co2Burden,
      airwayProtected: clinical.airwayProtected,
      effectiveVentilationActive: clinical.effectiveVentilationActive,
      directOxygenEffectOnCO2: clinical.directOxygenEffectOnCO2,
      ventilationEffectCount: clinical.ventilationEffectCount,
      definitiveControl: clinical.definitiveControl,
      causeControlled: clinical.causeControlled,
      respiratoryArrest: clinical.respiratoryArrest,
      CO2Trend: clinical.co2Trend,
      ...(clinical.mentalStatusSourceModule
        ? { mentalStatusSourceModule: clinical.mentalStatusSourceModule }
        : {}),
      ...(clinical.mentalStatusSourceProcessType
        ? { mentalStatusSourceProcessType: clinical.mentalStatusSourceProcessType }
        : {}),
    },
    ...(clinical.mentalStatusSourceModule
      ? { mentalStatusCeiling: clinical.respiratoryArrest ? "Arrest" as const : "Drowsy" as const }
      : {}),
    ...(clinical.respiratoryArrest ? { statusProposal: "Arrest" as const } : {}),
    observedAtSec: process.elapsedTime,
  };
}

export function bootstrapHvPatientProcess(fixture: GoldenFixture): PatientProcessRuntime {
  const initial = object(fixture.initialState);
  if (String(initial.processType) !== "HYPOVENTILATION_HYPERCAPNIA") {
    throw new Error(`NOT_IMPLEMENTED: fixture ${fixture.fixtureId} processType pole HV.`);
  }
  const processId = String(initial.processId ?? initial.templateId ?? fixture.fixtureId.replace(/^FX-/, ""));
  const encounterId = fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`;
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    processId,
    encounterId,
    instanceKey: String(initial.instanceKey ?? `${processId}:primary`),
    processType: String(initial.processType),
    templateId: String(initial.templateId ?? processId),
    state: String(initial.status) === "Controlled" ? "Controlled" : "Active",
    elapsedTime: 0,
    clinicalState: {
      ventilationReserve: requiredNumber(initial, "ventilationReserve"),
      reserveLossPerMin: optionalNumber(initial, "reserveLossPerMin"),
      co2Burden: requiredNumber(initial, "co2Burden"),
      co2GainPerMin: optionalNumber(initial, "co2GainPerMin"),
      causeControlled: Boolean(initial.causeControlled),
      airwayProtected: Boolean(initial.airwayProtected),
      effectiveVentilationActive: Boolean(initial.effectiveVentilationActive),
      directOxygenEffectOnCO2: 0,
      reserveSupportPerMin: 0,
      co2ClearancePerMin: 0,
      ventilationEffectCount: 0,
      definitiveControl: Boolean(initial.definitiveControl),
      respiratoryArrest: Boolean(initial.respiratoryArrest),
      oxygenTherapyActive: Boolean(initial.oxygenTherapyActive),
      co2Trend: "STABLE",
      oxygenMaskingWarningEmitted: false,
    },
    nextTick: 60,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function tickHvPatientProcess(
  previous: PatientProcessRuntime,
  tickSeconds: number
): PatientProcessRuntime {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
    throw new Error("ENGINE_TICK kestus peab olema positiivne arv sekundeid.");
  }
  if (previous.state === "Resolved") return structuredClone(previous);
  const minutes = tickSeconds / 60;
  const clinicalState = {
    ...previous.clinicalState,
    ventilationReserve: Math.max(
      0,
      previous.clinicalState.ventilationReserve +
        (previous.clinicalState.reserveSupportPerMin - previous.clinicalState.reserveLossPerMin) * minutes
    ),
    co2Burden: Math.min(
      100,
      previous.clinicalState.co2Burden +
        (previous.clinicalState.co2GainPerMin - previous.clinicalState.co2ClearancePerMin) * minutes
    ),
  };
  clinicalState.co2Trend = clinicalState.co2Burden > previous.clinicalState.co2Burden
    ? "WORSENING"
    : clinicalState.co2Burden < previous.clinicalState.co2Burden
      ? "IMPROVING"
      : "STABLE";
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous),
    clinicalState,
    elapsedTime: previous.elapsedTime + tickSeconds,
    nextTick: previous.nextTick + tickSeconds,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export type HvAction = "OXYGEN_HIGH_FLOW" | "INTUBATION" | "BVM_VENTILATION" | "MECHANICAL_VENTILATION";

export function applyHvAction(
  previous: PatientProcessRuntime,
  action: HvAction
): PatientProcessRuntime {
  const clinicalState = { ...previous.clinicalState };
  let state = previous.state;
  if (action === "OXYGEN_HIGH_FLOW") {
    clinicalState.directOxygenEffectOnCO2 = 0;
    clinicalState.oxygenTherapyActive = true;
  }
  if (action === "INTUBATION") {
    clinicalState.airwayProtected = true;
    clinicalState.effectiveVentilationActive = false;
  }
  if (action === "BVM_VENTILATION") {
    clinicalState.effectiveVentilationActive = true;
    clinicalState.reserveSupportPerMin = 5.42;
    clinicalState.co2ClearancePerMin = 7.6;
    clinicalState.ventilationEffectCount = 1;
  }
  if (action === "MECHANICAL_VENTILATION") {
    clinicalState.airwayProtected = true;
    clinicalState.effectiveVentilationActive = true;
    clinicalState.reserveSupportPerMin = 5.8;
    clinicalState.co2ClearancePerMin = 8.5;
    clinicalState.ventilationEffectCount = 1;
    clinicalState.definitiveControl = true;
    clinicalState.causeControlled = true;
    state = "Controlled";
  }
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous), state, clinicalState,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export type HvTimedTransition =
  | "CO2_NARCOSIS_TRIGGERED"
  | "RESPIRATORY_ARREST"
  | "HYPOVENTILATION_HYPOXIA_TRIGGERED";

export function applyHvTimedTransition(
  previous: PatientProcessRuntime,
  transition: HvTimedTransition
): PatientProcessRuntime {
  if (transition === "HYPOVENTILATION_HYPOXIA_TRIGGERED") {
    return structuredClone(previous);
  }
  const clinicalState = {
    ...previous.clinicalState,
    mentalStatusSourceModule: hvModuleId,
    mentalStatusSourceProcessType: "HYPOVENTILATION_HYPERCAPNIA",
    ...(transition === "RESPIRATORY_ARREST" ? { respiratoryArrest: true } : {}),
  };
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous), clinicalState,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function markOxygenMaskingWarning(
  previous: PatientProcessRuntime
): PatientProcessRuntime {
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous),
    clinicalState: { ...previous.clinicalState, oxygenMaskingWarningEmitted: true },
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function setHvOxygenTherapy(
  previous: PatientProcessRuntime,
  active: boolean
): PatientProcessRuntime {
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous),
    clinicalState: {
      ...previous.clinicalState,
      oxygenTherapyActive: active,
      directOxygenEffectOnCO2: 0,
    },
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}
