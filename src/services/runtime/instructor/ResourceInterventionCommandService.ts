import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion } from "@/services/RuntimeSnapshotService";
import { getInstructorRuntimeOwner } from "./InstructorRuntimeEventRegistry";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { advanceExerciseMinutes } from "@/services/ClockService";
import { getRegisteredExerciseClockTargetIds } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";

export type ResourceInterventionCommandResult =
  | Readonly<{ ok: true; commandId: string; runtimeEventId: string }>
  | Readonly<{ ok: false; commandId: string; errorCode: "UNAVAILABLE" | "RUNTIME_FAILURE"; message: string }>;

const results = new Map<string, ResourceInterventionCommandResult>();
let manualAdvanceSequence = 0;

export function createManualRuntimeAdvanceCommandId(exerciseId: string, patientId: string): string {
  manualAdvanceSequence += 1;
  const simulationTimeSec = getCanonicalExerciseSnapshot().simulationTimeSec;
  return `RUNTIME-${exerciseId}-${patientId}-${simulationTimeSec}-${manualAdvanceSequence}`;
}

export function handleResourceInterventionCommand(command: Readonly<{ commandId: string; exerciseId: string;
  patientId: string; resourceId: string; issuedBy: string }>): ResourceInterventionCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const owner = getInstructorRuntimeOwner(command.exerciseId, command.patientId);
  const exercise = getCanonicalExerciseSnapshot();
  const resourceBefore = getPatientResourceDebugSnapshot(command.patientId).resources.find(item => item.resourceId === command.resourceId);
  const timedAccess = resourceBefore?.type === "peripheralIV" || resourceBefore?.type === "centralVenousCatheter";
  const canonicalSimulationTimeSec = owner?.executeResourceIntervention && exercise.exerciseId === command.exerciseId && exercise.lifecycleState === "RUNNING"
    ? exercise.simulationTimeSec + (timedAccess ? 0 : 60) : undefined;
  const applied = owner?.executeResourceIntervention?.(command.commandId, command.resourceId, canonicalSimulationTimeSec);
  if (applied?.ok && canonicalSimulationTimeSec !== undefined && !timedAccess) advanceExerciseMinutes(1);
  const result: ResourceInterventionCommandResult = !applied
    ? { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "Resource runtime is not available" }
    : applied.ok
      ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: applied.reason };
  if (result.ok) {
    const simulationTimeSec = getCanonicalPatientRuntimeSnapshot(command.patientId)?.state.exerciseTimeSec ?? 0;
    const resource = getPatientResourceDebugSnapshot(command.patientId).resources.find(item => item.resourceId === command.resourceId);
    const chestDrain = resource?.type === "chestDrain";
    const accessTitle = resource?.type === "peripheralIV" ? "Perifeerse veenitee rajamine alustatud"
      : resource?.type === "centralVenousCatheter" ? "Tsentraalveenitee rajamine alustatud" : undefined;
    addTimelineEvent({ id: `TL-RESOURCE-${command.commandId}`, exerciseId: command.exerciseId, patientId: command.patientId,
      timestamp: `T+${simulationTimeSec}s`, simulationTimeSec, type: "intervention", title: accessTitle ?? (chestDrain ? "Chest drain inserted" : "Resource intervention applied"),
      description: accessTitle ? `Kanoonilise vaskulaarse ligipääsu ${command.resourceId} rajamine algas` : chestDrain
        ? "Canonical pleural drainage intervention applied" : `Canonical resource ${command.resourceId} applied`, author: command.issuedBy, visibility: "revealed" });
  }
  results.set(command.commandId, structuredClone(result));
  return structuredClone(result);
}

export function resetResourceInterventionCommands(): void { results.clear(); manualAdvanceSequence = 0; }

export function advancePatientRuntime(command: Readonly<{ commandId: string; exerciseId: string; patientId: string;
  durationSec: number; issuedBy: string }>): ResourceInterventionCommandResult {
  const previous = results.get(command.commandId);
  if (previous) return structuredClone(previous);
  const owner = getInstructorRuntimeOwner(command.exerciseId, command.patientId);
  const exercise = getCanonicalExerciseSnapshot();
  const targetIds = getRegisteredExerciseClockTargetIds();
  const identityValid = exercise.exerciseId === command.exerciseId && exercise.lifecycleState === "RUNNING";
  const targetValid = targetIds.includes(command.patientId);
  const canonicalSimulationTimeSec = identityValid && targetValid ? exercise.simulationTimeSec + command.durationSec : undefined;
  const patientSnapshotBefore = getCanonicalPatientRuntimeSnapshot(command.patientId);
  const snapshotVersionBefore = getRuntimeSnapshotVersion();
  const applied = canonicalSimulationTimeSec === undefined ? undefined
    : owner?.advanceRuntime?.(command.commandId, command.durationSec, canonicalSimulationTimeSec);
  if (applied?.ok) advanceExerciseMinutes(command.durationSec / 60);
  const exerciseAfter = getCanonicalExerciseSnapshot();
  const patientSnapshotAfter = getCanonicalPatientRuntimeSnapshot(command.patientId);
  const clockAdvanced = exerciseAfter.exerciseId === command.exerciseId
    && exerciseAfter.simulationTimeSec >= exercise.simulationTimeSec + command.durationSec;
  const snapshotAdvanced = getRuntimeSnapshotVersion() > snapshotVersionBefore
    && patientSnapshotAfter !== undefined
    && patientSnapshotAfter.state.exerciseTimeSec >= exercise.simulationTimeSec + command.durationSec
    && patientSnapshotAfter.state.exerciseTimeSec > (patientSnapshotBefore?.state.exerciseTimeSec ?? -1);
  const result: ResourceInterventionCommandResult = !identityValid
    ? { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: "Õppuse canonical kell ei vasta aktiivsele käimasolevale õppusele" }
    : !targetValid
      ? { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: "Patsiendi Runtime ei ole canonical kellaga seotud" }
      : !applied
    ? { ok: false, commandId: command.commandId, errorCode: "UNAVAILABLE", message: "Clinical runtime is not available" }
    : applied.ok && clockAdvanced && snapshotAdvanced ? { ok: true, commandId: command.commandId, runtimeEventId: applied.runtimeEventId }
      : applied.ok ? { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: "Canonical kliiniline aeg ei liikunud" }
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
