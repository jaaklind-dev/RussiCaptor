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

function output(process: Omit<PatientProcessRuntime, "outputs">): ProcessOutput {
  return {
    processId: process.processId,
    encounterId: process.encounterId,
    moduleId: hvModuleId,
    status: process.state,
    globalSeverityScore: Math.min(1, Math.max(0, process.clinicalState.co2Burden / 100)),
    respiratoryPriority: 100,
    runtimeContributions: {
      ventilationReserve: process.clinicalState.ventilationReserve,
      co2Burden: process.clinicalState.co2Burden,
    },
    observedAtSec: process.elapsedTime,
  };
}

export function bootstrapHvPatientProcess(fixture: GoldenFixture): PatientProcessRuntime {
  const initial = object(fixture.initialState);
  if (String(initial.processType) !== "HYPOVENTILATION_HYPERCAPNIA") {
    throw new Error(`NOT_IMPLEMENTED: fixture ${fixture.fixtureId} processType pole HV.`);
  }
  const processId = String(initial.processId ?? initial.templateId ?? fixture.fixtureId);
  const encounterId = fixture.patientId ?? `GOLDEN-${fixture.fixtureId}`;
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    processId,
    encounterId,
    instanceKey: String(initial.instanceKey ?? `${processId}:primary`),
    processType: String(initial.processType),
    templateId: String(initial.templateId),
    state: String(initial.status) === "Controlled" ? "Controlled" : "Active",
    elapsedTime: 0,
    clinicalState: {
      ventilationReserve: requiredNumber(initial, "ventilationReserve"),
      reserveLossPerMin: requiredNumber(initial, "reserveLossPerMin"),
      co2Burden: requiredNumber(initial, "co2Burden"),
      co2GainPerMin: requiredNumber(initial, "co2GainPerMin"),
      causeControlled: Boolean(initial.causeControlled),
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
      previous.clinicalState.ventilationReserve - previous.clinicalState.reserveLossPerMin * minutes
    ),
    co2Burden: Math.min(
      100,
      previous.clinicalState.co2Burden + previous.clinicalState.co2GainPerMin * minutes
    ),
  };
  const processWithoutOutput: Omit<PatientProcessRuntime, "outputs"> = {
    ...structuredClone(previous),
    clinicalState,
    elapsedTime: previous.elapsedTime + tickSeconds,
    nextTick: previous.nextTick + tickSeconds,
  };
  return { ...processWithoutOutput, outputs: output(processWithoutOutput) };
}
