import type { RuntimePatientCommandMaterialization, RuntimePatientCommandSubmissionResult } from "@/models/RuntimePatientCommand";
import type { NarvaIroScenarioControlCommandType, NarvaIroVentilationFault } from "@/models/NarvaIroScenario";
import { isNarvaIroScenarioControlCommandType } from "@/models/NarvaIroScenario";
import { getInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { getRuntimePatientCommandGateway, submitPatientRuntimeCommand,
  waitForPatientRuntimeCommandResult } from "@/services/runtime/commands/RuntimePatientCommandService";

export type NarvaIroScenarioControlCommand = Readonly<{
  commandId: string;
  exerciseId: string;
  patientId: string;
  commandType: NarvaIroScenarioControlCommandType;
  payload: Readonly<Record<string, unknown>>;
  issuedBy: string;
  acceptedDurableSimulationTimeSec?: number;
}>;

export type NarvaIroScenarioControlLocalResult = Readonly<
  { ok: true; commandId: string; runtimeEventId: string } |
  { ok: false; commandId: string; errorCode: "INVALID_COMMAND_PAYLOAD" | "RUNTIME_UNAVAILABLE" | "RUNTIME_FAILURE"; message: string }
>;

export type NarvaIroScenarioControlSubmission = Readonly<{
  commandId: string;
  status: "ACCEPTED" | "IDEMPOTENT" | "MATERIALIZED" | "REJECTED";
  commandSequence?: number;
  message?: string;
}>;

const ventilationFaults = new Set<NarvaIroVentilationFault>([
  "CIRCUIT_DISCONNECT", "HIGH_PRESSURE_KINK", "OXYGEN_DEPLETION", "VENTILATOR_STOP",
]);
let commandSequence = 0;
const localResults = new Map<string, NarvaIroScenarioControlLocalResult>();

export function createNarvaIroScenarioControlCommandId(
  exerciseId: string,
  patientId: string,
  commandType: NarvaIroScenarioControlCommandType,
): string {
  commandSequence += 1;
  return `IRO-${exerciseId}-${patientId}-${commandType}-${Date.now()}-${commandSequence}`;
}

function faultType(payload: Readonly<Record<string, unknown>>): NarvaIroVentilationFault | undefined {
  const value = payload.faultType;
  return typeof value === "string" && ventilationFaults.has(value as NarvaIroVentilationFault)
    ? value as NarvaIroVentilationFault : undefined;
}

function validPayload(command: NarvaIroScenarioControlCommand): boolean {
  const keys = Object.keys(command.payload);
  return command.commandType === "IRO_VENTILATION_FAULT_START"
    ? keys.length === 1 && keys[0] === "faultType" && Boolean(faultType(command.payload))
    : keys.length === 0;
}

export function handleNarvaIroScenarioControlCommand(
  command: NarvaIroScenarioControlCommand,
): NarvaIroScenarioControlLocalResult {
  const previous = localResults.get(command.commandId);
  if (previous) return structuredClone(previous);
  if (!isNarvaIroScenarioControlCommandType(command.commandType) || !validPayload(command)) {
    return Object.freeze({ ok: false, commandId: command.commandId,
      errorCode: "INVALID_COMMAND_PAYLOAD", message: "IRO stsenaariumikäsu sisu ei ole korrektne." });
  }
  const applied = getInstructorRuntimeOwner(command.exerciseId, command.patientId)
    ?.executeNarvaIroScenarioControl?.(command.commandId, command.commandType, faultType(command.payload),
      command.acceptedDurableSimulationTimeSec);
  const result: NarvaIroScenarioControlLocalResult = !applied
    ? { ok: false, commandId: command.commandId, errorCode: "RUNTIME_UNAVAILABLE", message: "IRO Runtime ei ole saadaval." }
    : applied.ok
      ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
  localResults.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}

function rejectionMessage(status: RuntimePatientCommandSubmissionResult["status"]): string {
  if (status === "AUTHORIZATION_DENIED") return "IRO juhtimiseks on vajalik aktiivne õppuse EXCON-õigus.";
  if (status === "COMPLETION_FENCED" || status === "EXERCISE_NOT_ACTIVE") return "Õppust lõpetatakse või see on lõppenud.";
  if (status === "STALE_VERSION") return "Patsiendi autoritaarne seis muutus. Värskenda vaadet.";
  return "IRO stsenaariumikäsku ei saanud autoritaarsesse järjekorda saata.";
}

export async function submitNarvaIroScenarioControlCommand(
  command: NarvaIroScenarioControlCommand,
): Promise<NarvaIroScenarioControlSubmission> {
  if (!getRuntimePatientCommandGateway()) {
    const local = handleNarvaIroScenarioControlCommand(command);
    return Object.freeze({ commandId: command.commandId, status: local.ok ? "MATERIALIZED" : "REJECTED",
      ...(!local.ok ? { message: local.message } : {}) });
  }
  const submitted = await submitPatientRuntimeCommand({ exerciseId: command.exerciseId, patientId: command.patientId,
    commandId: command.commandId, commandType: command.commandType, payload: command.payload });
  if (submitted.status === "APPLIED" || submitted.status === "IDEMPOTENT") {
    return Object.freeze({ commandId: command.commandId,
      status: submitted.status === "APPLIED" ? "ACCEPTED" : "IDEMPOTENT",
      commandSequence: submitted.commandSequence });
  }
  return Object.freeze({ commandId: command.commandId, status: "REJECTED", message: rejectionMessage(submitted.status) });
}

export async function waitForNarvaIroScenarioControlMaterialization(
  exerciseId: string,
  commandSequence: number,
): Promise<RuntimePatientCommandMaterialization | undefined> {
  return waitForPatientRuntimeCommandResult(exerciseId, commandSequence);
}

export function resetNarvaIroScenarioControlCommands(): void {
  localResults.clear(); commandSequence = 0;
}
