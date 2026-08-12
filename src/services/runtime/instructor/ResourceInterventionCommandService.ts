import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

export type ResourceInterventionCommandResult =
  | Readonly<{ ok: true; commandId: string; runtimeEventId: string }>
  | Readonly<{ ok: false; commandId: string; errorCode: "UNAVAILABLE" | "RUNTIME_FAILURE"; message: string }>;

const results = new Map<string, ResourceInterventionCommandResult>();

export function handleResourceInterventionCommand(command: Readonly<{ commandId: string; exerciseId: string;
  patientId: string; resourceId: string; issuedBy: string }>): ResourceInterventionCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const owner = getInstructorRuntimeOwner(command.exerciseId, command.patientId);
  const applied = owner?.executeResourceIntervention?.(command.commandId, command.resourceId);
  const result: ResourceInterventionCommandResult = !applied
    ? { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "Resource runtime is not available" }
    : applied.ok
      ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
  if (result.ok) {
    const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0;
    addTimelineEvent({ id: `TL-RESOURCE-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId,
      timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "intervention", title: "Resource intervention applied",
      description: `Canonical resource ${command.resourceId} applied`, author: command.issuedBy, visibility: "revealed" });
  }
  results.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}

export function resetResourceInterventionCommands(): void { results.clear(); }

export function advancePatientRuntime(command: Readonly<{ commandId: string; exerciseId: string; patientId: string;
  durationSec: number; issuedBy: string }>): ResourceInterventionCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const applied = getInstructorRuntimeOwner(command.exerciseId, command.patientId)?.advanceRuntime?.(command.commandId, command.durationSec);
  const result: ResourceInterventionCommandResult = !applied
    ? { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "Clinical runtime is not available" }
    : applied.ok ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
  if (result.ok) {
    const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0;
    addTimelineEvent({ id: `TL-RUNTIME-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId,
      timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "status", title: "Clinical runtime advanced",
      description: `Canonical patient runtime advanced by ${command.durationSec} seconds`, author: command.issuedBy, visibility: "revealed" });
  }
  results.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}
