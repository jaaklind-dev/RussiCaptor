import type { GoldenFixture } from "@/models/GoldenTest";
import type { HypoxiaPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const hypoxiaModuleId = "HYPOXIA_V1";

function output(process: Omit<HypoxiaPatientProcessRuntime, "outputs">): ProcessOutput {
  return {
    processId: process.processId,
    encounterId: process.encounterId,
    moduleId: hypoxiaModuleId,
    status: process.state,
    globalSeverityScore: Math.min(1, Math.max(0, (100 - process.clinicalState.oxygenationReserve) / 100)),
    oxygenationPriority: 100,
    spo2Ceiling: process.clinicalState.spo2,
    runtimeContributions: {
      oxygenationReserve: process.clinicalState.oxygenationReserve,
      SpO2Trend: process.clinicalState.spo2Trend,
      SpO2Owner: hypoxiaModuleId,
    },
    observedAtSec: process.elapsedTime,
  };
}

export function bootstrapHypoxiaPatientProcess(
  fixture: GoldenFixture,
  initial: Record<string, unknown>,
  parent?: { processId: string; processType: string; instanceKey: string }
): HypoxiaPatientProcessRuntime {
  const templateId = String(initial.templateId ?? "HYP_HYPOVENT_MOD");
  const processId = String(initial.processId ?? `${parent?.processId ?? fixture.fixtureId}:${templateId}`);
  const processWithoutOutput: Omit<HypoxiaPatientProcessRuntime, "outputs"> = {
    processId,
    encounterId: fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`,
    instanceKey: String(initial.instanceKey ?? `${parent?.instanceKey ?? fixture.fixtureId}:hypoxia`),
    processType: "HYPOXIA",
    templateId,
    state: "Active",
    elapsedTime: 0,
    clinicalState: {
      oxygenationReserve: Number(initial.oxygenationReserve ?? 60),
      spo2: Number(initial.spo2 ?? 90),
      oxygenTherapyActive: Boolean(initial.oxygenTherapyActive),
      spo2Trend: "STABLE",
    },
    nextTick: 60,
    parentProcessId: parent?.processId,
    parentProcessType: parent?.processType,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function applyHypoxiaOxygen(
  previous: HypoxiaPatientProcessRuntime
): HypoxiaPatientProcessRuntime {
  return setHypoxiaOxygenTherapy(previous, true);
}

export function setHypoxiaOxygenTherapy(
  previous: HypoxiaPatientProcessRuntime,
  active: boolean
): HypoxiaPatientProcessRuntime {
  const processWithoutOutput: Omit<HypoxiaPatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous),
    clinicalState: { ...previous.clinicalState, oxygenTherapyActive: active },
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}

export function tickHypoxiaPatientProcess(
  previous: HypoxiaPatientProcessRuntime,
  tickSeconds: number
): HypoxiaPatientProcessRuntime {
  const minutes = tickSeconds / 60;
  const supported = previous.clinicalState.oxygenTherapyActive;
  const oxygenationReserve = Math.max(0, Math.min(
    100,
    previous.clinicalState.oxygenationReserve + (supported ? 2 : -1) * minutes
  ));
  const spo2 = Math.max(40, Math.min(100, previous.clinicalState.spo2 + (supported ? 2 : -1) * minutes));
  const clinicalState = {
    ...previous.clinicalState,
    oxygenationReserve,
    spo2,
    spo2Trend: spo2 > previous.clinicalState.spo2
      ? "IMPROVING" as const
      : spo2 < previous.clinicalState.spo2
        ? "WORSENING" as const
        : "STABLE" as const,
  };
  const processWithoutOutput: Omit<HypoxiaPatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous), clinicalState,
    elapsedTime: previous.elapsedTime + tickSeconds,
    nextTick: previous.nextTick + tickSeconds,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}
