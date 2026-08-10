import type { CardiacInterventionCommand, CardiacInterventionCommandResult } from "@/models/CardiacInterventionCommand";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";

const results = new Map<string, CardiacInterventionCommandResult>();

export function handleCardiacInterventionCommand(command: CardiacInterventionCommand): CardiacInterventionCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const owner = getInstructorRuntimeOwner(command.exerciseId, command.patientId);
  const cardiac = getCanonicalPatientRuntimeSnapshot(command.patientId)?.processes
    .find(process => process.moduleId === "CARDIAC_ARREST_V1")?.clinicalState;
  let result: CardiacInterventionCommandResult;
  if (!owner?.executeClinicalIntervention || !cardiac) {
    result = { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "Cardiac runtime is not available" };
  } else if ((command.action === "START_CPR" && cardiac.cprActive === true) ||
    (command.action === "STOP_CPR" && cardiac.cprActive !== true) ||
    (command.action === "DEFIBRILLATION" && cardiac.cardiacState !== "ARREST")) {
    result = { ok: false, commandId: command.commandId, errorCode: "INVALID_STATE", message: "Action is not valid in the current cardiac state" };
  } else {
    const applied = owner.executeClinicalIntervention(command.commandId, command.action);
    result = applied.ok ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
    if (applied.ok) {
      const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0;
      const labels = { START_CPR: "CPR started", STOP_CPR: "CPR stopped", DEFIBRILLATION: "Defibrillation attempted" } as const;
      addTimelineEvent({ id: `TL-CARDIAC-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId,
        timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "intervention", title: labels[command.action],
        description: `Canonical ${command.action} intervention accepted`, author: command.issuedBy, visibility: "revealed" });
    }
  }
  results.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}

export function resetCardiacInterventionCommands(): void { results.clear(); }
