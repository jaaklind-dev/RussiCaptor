import { addTimelineEvent, getAllTimelineEvents } from "@/repositories/TimelineRepository";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";
import { isResourceInterventionAllowed } from "@/services/exercise/PackageInterventionAvailabilityService";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";
import { canonicalEttEvidenceId } from "@/services/runtime/commands/EndotrachealIntubationCanonicalCommit";

export type EndotrachealIntubationCommand = Readonly<{
  commandId: string; exerciseId: string; patientId: string; tubeResourceId: string;
  laryngoscopeResourceId: string; capnographyResourceId?: string; device: "DIRECT" | "VIDEO";
  tubeSize: number; cuff: boolean; confirmation: boolean; issuedBy: string;
}>;

export type EndotrachealIntubationCommandResult =
  | Readonly<{ ok: true; commandId: string; runtimeEventId: string }>
  | Readonly<{ ok: false; commandId: string; errorCode: "TUBE_UNAVAILABLE" | "LARYNGOSCOPE_UNAVAILABLE" |
      "RESOURCE_UNAVAILABLE" | "INVALID_PARAMETER" | "INTERVENTION_REJECTED" | "RUNTIME_UNAVAILABLE"; message: string }>;

const results = new Map<string, EndotrachealIntubationCommandResult>();
let sequence = 0;

export function createEndotrachealIntubationCommandId(exerciseId: string, patientId: string): string {
  sequence += 1;
  return `ETT-${exerciseId}-${patientId}-${getCanonicalExerciseSnapshot().simulationTimeSec}-${sequence}`;
}

/** Writer-side materialization boundary. Production UI must use submitEndotrachealIntubationCommand. */
export function handleEndotrachealIntubationCommand(command: EndotrachealIntubationCommand): EndotrachealIntubationCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const exercise = getCanonicalExerciseSnapshot();
  if (!isResourceInterventionAllowed(command.exerciseId, command.patientId, "ENDOTRACHEAL_INTUBATION")) {
    const result: EndotrachealIntubationCommandResult = { ok: false, commandId: command.commandId,
      errorCode: "INTERVENTION_REJECTED", message: "Intervention is not available for this package patient" };
    results.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }
  const owner = getInstructorRuntimeOwner(command.exerciseId, command.patientId);
  const applied = exercise.exerciseId === command.exerciseId && exercise.lifecycleState === "RUNNING"
    ? owner?.executeResourceAwareIntervention?.(command.commandId, "ENDOTRACHEAL_INTUBATION",
      [command.tubeResourceId, command.laryngoscopeResourceId, ...(command.capnographyResourceId ? [command.capnographyResourceId] : [])],
      { device: command.device, tubeSize: command.tubeSize, cuff: command.cuff, confirmation: command.confirmation })
    : undefined;
  const knownCodes = new Set(["TUBE_UNAVAILABLE", "LARYNGOSCOPE_UNAVAILABLE", "RESOURCE_UNAVAILABLE",
    "INVALID_PARAMETER", "INTERVENTION_REJECTED"]);
  const errorCode = applied && !applied.ok && applied.code && knownCodes.has(applied.code)
    ? applied.code as Exclude<EndotrachealIntubationCommandResult, { ok: true }>['errorCode'] : "RUNTIME_UNAVAILABLE";
  const result: EndotrachealIntubationCommandResult = !applied
    ? { ok: false, commandId: command.commandId, errorCode: "RUNTIME_UNAVAILABLE", message: "Kliiniline Runtime ei ole kirjutamiseks valmis." }
    : applied.ok ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode, message: applied.reason };
  if (result.ok) {
    const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0;
    const evidenceId = canonicalEttEvidenceId(command.commandId);
    if (!getAllTimelineEvents().some(event => event.id === evidenceId)) {
      addTimelineEvent({ id: evidenceId, exerciseId: command.exerciseId, patientId: command.patientId,
        timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "intervention", title: "Endotrahheaalne intubatsioon",
        description: `ETT ${command.tubeSize} paigaldati ja asend kinnitati`, author: command.issuedBy, visibility: "revealed" });
    }
  }
  results.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}

export async function submitEndotrachealIntubationCommand(command: EndotrachealIntubationCommand):
Promise<EndotrachealIntubationCommandResult> {
  const submitted = await submitPatientRuntimeCommand({ exerciseId: command.exerciseId,
    patientId: command.patientId, commandId: command.commandId,
    commandType: "ENDOTRACHEAL_INTUBATION", payload: Object.freeze({
      tubeResourceId: command.tubeResourceId,
      laryngoscopeResourceId: command.laryngoscopeResourceId,
      ...(command.capnographyResourceId ? { capnographyResourceId: command.capnographyResourceId } : {}),
      device: command.device, tubeSize: command.tubeSize, cuff: command.cuff,
      confirmation: command.confirmation,
    }) });
  if (submitted.status === "APPLIED" || submitted.status === "IDEMPOTENT") {
    return Object.freeze({ ok: true, commandId: command.commandId,
      runtimeEventId: `QUEUED-${submitted.commandSequence ?? command.commandId}` });
  }
  return Object.freeze({ ok: false, commandId: command.commandId,
    errorCode: "RUNTIME_UNAVAILABLE",
    message: submitted.status === "RECONNECT_REQUIRED" || submitted.status === "STALE_VERSION" ||
      submitted.status === "NOT_OWNER"
      ? "Patsiendi andmeid sünkroniseeritakse. Proovi uuesti."
      : submitted.status === "COMPLETION_FENCED" || submitted.status === "EXERCISE_NOT_ACTIVE"
        ? "Õppust lõpetatakse või see on lõppenud."
        : "Intubatsioonikäsku ei saanud tööjärjekorda saata." });
}

export function resetEndotrachealIntubationCommands(): void { results.clear(); sequence = 0; }
