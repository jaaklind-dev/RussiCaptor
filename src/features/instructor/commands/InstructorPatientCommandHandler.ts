import type { InstructorCommandAuditEntry, InstructorCommandResult, InstructorPatientCommand } from "@/models/InstructorCommand";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { notifySync } from "@/services/SyncService";
import { validateInstructorPatientCommand } from "./InstructorPatientCommandValidator";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

const results = new Map<string, InstructorCommandResult>();
const audit: InstructorCommandAuditEntry[] = [];

function recordRejected(command: InstructorPatientCommand, result: Extract<InstructorCommandResult, { ok: false }>): InstructorCommandResult {
  results.set(command.commandId, result);
  audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, patientId: command.patientId, eventType: command.eventType,
    issuedBy: command.issuedBy, simulationTime: command.issuedAtSimulationTime, outcome: "REJECTED", errorCode: result.errorCode });
  return result;
}

export function handleInstructorPatientCommand(command: InstructorPatientCommand): InstructorCommandResult {
  const previous = results.get(command?.commandId);
  if (previous) return previous;
  const exercise = getCurrentExercise();
  const patient = findPatientById(command?.patientId);
  const owner = command ? getInstructorRuntimeOwner(command.exerciseId, command.patientId) : undefined;
  const validation = validateInstructorPatientCommand(command, { activeExerciseId: exercise?.id, exerciseLifecycleState: getCanonicalExerciseSnapshot().lifecycleState,
    patientExists: Boolean(patient), patientBelongsToExercise: Boolean(patient), runtimeOwner: owner });
  if (validation && !validation.ok) return recordRejected(command, validation);
  try {
    const runtimeResult = owner!.execute(command);
    if (!runtimeResult.ok) return recordRejected(command, { ok: false, commandId: command.commandId, errorCode: "UNSUPPORTED_STATE", message: runtimeResult.reason });
    const result: InstructorCommandResult = { ok: true, commandId: command.commandId, runtimeEventId: runtimeResult.runtimeEventId };
    results.set(command.commandId, result);
    audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, patientId: command.patientId, eventType: command.eventType,
      issuedBy: command.issuedBy, simulationTime: command.issuedAtSimulationTime, outcome: "ACCEPTED" });
    addTimelineEvent({ id: `TL-INSTRUCTOR-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId,
      timestamp: `T+${command.issuedAtSimulationTime}s`, type: "instructor", title: "Exercise Controller event injected",
      description: command.eventType.replaceAll("_", " ").toLowerCase(), author: command.issuedBy, visibility: "revealed" });
    notifySync("local");
    return result;
  } catch {
    return recordRejected(command, { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: "Runtime rejected the command" });
  }
}

export function getInstructorCommandAudit(): readonly InstructorCommandAuditEntry[] { return structuredClone(audit); }
export function resetInstructorCommandHandler(): void { results.clear(); audit.length = 0; }
