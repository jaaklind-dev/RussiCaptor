import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { notifySync } from "@/services/SyncService";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";
import { AuthoritativeExerciseRuntime } from "./AuthoritativeExerciseRuntime";
import { registerExerciseRuntimeOwner } from "./ExerciseRuntimeOwnerRegistry";

export type ExerciseResetCommand = Readonly<{ commandId: string; currentExerciseId: string; newExerciseId: string; issuedBy: string; expectedVersion: number }>;
export type ExerciseResetAudit = Readonly<{ commandId: string; priorExerciseId: string; newExerciseId: string; simulationTimeSec: number; outcome: "ACCEPTED" | "REJECTED"; reasonCode?: "ACTIVE_EXERCISE" | "UNAUTHORIZED" | "VERSION_CONFLICT" | "INVALID_EXERCISE_ID" }>;
export type ExerciseResetResult = Readonly<{ ok: true; snapshot: CanonicalExerciseSnapshot; archivedSnapshot?: CanonicalExerciseSnapshot; audit: ExerciseResetAudit } | { ok: false; snapshot: CanonicalExerciseSnapshot; audit: ExerciseResetAudit }>;

const resetResults = new Map<string, ExerciseResetResult>();
const archived = new Map<string, CanonicalExerciseSnapshot>();
const resetAudit: ExerciseResetAudit[] = [];

/** Explicit canonical reset for preparing a new exercise; never used by replay. */
export function executeExerciseReset(command: ExerciseResetCommand): ExerciseResetResult {
  const priorResult = resetResults.get(command.commandId); if (priorResult) return structuredClone(priorResult);
  const current = getCanonicalExerciseSnapshot();
  const reject = (reasonCode: NonNullable<ExerciseResetAudit["reasonCode"]>): ExerciseResetResult => ({ ok: false, snapshot: current, audit: Object.freeze({ commandId: command.commandId, priorExerciseId: current.exerciseId, newExerciseId: command.newExerciseId, simulationTimeSec: current.simulationTimeSec, outcome: "REJECTED", reasonCode }) });
  let result: ExerciseResetResult;
  if (command.issuedBy !== "Exercise Controller") result = reject("UNAUTHORIZED");
  else if (command.expectedVersion !== current.version || command.currentExerciseId !== current.exerciseId) result = reject("VERSION_CONFLICT");
  else if (!command.newExerciseId.trim() || command.newExerciseId === current.exerciseId) result = reject("INVALID_EXERCISE_ID");
  else if (current.lifecycleState === "RUNNING" || current.lifecycleState === "PAUSED") result = reject("ACTIVE_EXERCISE");
  else {
    stopClockRunner();
    const archivedSnapshot = current.lifecycleState === "COMPLETED" ? structuredClone(current) : undefined;
    if (archivedSnapshot) archived.set(current.exerciseId, archivedSnapshot);
    const snapshot: CanonicalExerciseSnapshot = { exerciseId: command.newExerciseId, lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: current.version + 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0, lastCommandId: command.commandId };
    installCurrentExercise(command.newExerciseId, command.newExerciseId);
    replaceCanonicalExerciseSnapshot(snapshot);
    registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime(command.newExerciseId));
    notifySync("local");
    result = { ok: true, snapshot: getCanonicalExerciseSnapshot(), archivedSnapshot, audit: Object.freeze({ commandId: command.commandId, priorExerciseId: current.exerciseId, newExerciseId: command.newExerciseId, simulationTimeSec: current.simulationTimeSec, outcome: "ACCEPTED" }) };
  }
  resetResults.set(command.commandId, structuredClone(result)); resetAudit.push(structuredClone(result.audit)); return structuredClone(result);
}

export function getArchivedExerciseSnapshot(exerciseId: string): CanonicalExerciseSnapshot | undefined { const value = archived.get(exerciseId); return value ? structuredClone(value) : undefined; }
export function getExerciseResetAudit(): readonly ExerciseResetAudit[] { return Object.freeze(structuredClone(resetAudit)); }
export function resetExerciseResetService(): void { resetResults.clear(); archived.clear(); resetAudit.length = 0; }
