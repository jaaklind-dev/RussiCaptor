import type { ExerciseControlAuditEntry, ExerciseControlCommand, ExerciseControlResult } from "@/models/exercise/ExerciseControlCommand";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getExerciseRuntimeOwner } from "./ExerciseRuntimeOwnerRegistry";
import { validateExerciseControlCommand } from "./ExerciseControlValidator";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { notifySync } from "@/services/SyncService";

const results = new Map<string, ExerciseControlResult>();
const audit: ExerciseControlAuditEntry[] = [];

export function handleExerciseControlCommand(command: ExerciseControlCommand): ExerciseControlResult {
  const prior = results.get(command?.commandId);
  if (prior) return prior;
  const snapshot = getCanonicalExerciseSnapshot();
  const owner = getExerciseRuntimeOwner();
  const rejected = validateExerciseControlCommand(command, snapshot, snapshot.exerciseId);
  if (rejected && !rejected.ok) {
    results.set(command.commandId, rejected);
    audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, commandType: command.commandType,
      issuer: command.issuedBy, simulationTimeSec: snapshot.simulationTimeSec, previousState: snapshot.lifecycleState,
      previousSpeed: snapshot.speed, outcome: "REJECTED", rejectionCode: rejected.errorCode });
    notifySync("local");
    return rejected;
  }
  if (!owner || owner.exerciseId !== command.exerciseId) {
    const result: ExerciseControlResult = { ok: false, commandId: command.commandId, errorCode: "NO_AUTHORITATIVE_OWNER", message: "Authoritative exercise runtime owner is not available" };
    results.set(command.commandId, result);
    audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, commandType: command.commandType, issuer: command.issuedBy,
      simulationTimeSec: snapshot.simulationTimeSec, previousState: snapshot.lifecycleState, previousSpeed: snapshot.speed,
      outcome: "REJECTED", rejectionCode: result.errorCode });
    notifySync("local");
    return result;
  }
  let applied: ReturnType<typeof owner.apply>;
  try { applied = owner.apply(command); }
  catch {
    const result: ExerciseControlResult = { ok: false, commandId: command.commandId, errorCode: "RUNTIME_FAILURE", message: "Authoritative runtime rejected the command" };
    results.set(command.commandId, result);
    audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, commandType: command.commandType, issuer: command.issuedBy,
      simulationTimeSec: snapshot.simulationTimeSec, previousState: snapshot.lifecycleState, previousSpeed: snapshot.speed,
      outcome: "REJECTED", rejectionCode: result.errorCode });
    notifySync("local");
    return result;
  }
  const result: ExerciseControlResult = { ok: true, commandId: command.commandId, ...applied };
  results.set(command.commandId, result);
  audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, commandType: command.commandType,
    issuer: command.issuedBy, simulationTimeSec: applied.snapshot.simulationTimeSec, previousState: snapshot.lifecycleState,
    resultingState: applied.snapshot.lifecycleState, previousSpeed: snapshot.speed, resultingSpeed: applied.snapshot.speed,
    outcome: "ACCEPTED", eventType: applied.eventType });
  return result;
}

export function getExerciseControlAudit(): readonly ExerciseControlAuditEntry[] { return structuredClone(audit); }
export function getExerciseControlReplayHash(): string {
  const { updatedAtWallClock: _metadata, clockVersion: _clockVersion, clockInitializedAtSimulationTimeSec: _clockInitialized, ...snapshot } = getCanonicalExerciseSnapshot();
  return sha256Text(stableJson({ snapshot, audit }));
}
export function resetExerciseControlCommandHandler(): void { results.clear(); audit.length = 0; }
export function restoreExerciseControlAudit(entries: readonly ExerciseControlAuditEntry[]): void {
  results.clear(); audit.splice(0, audit.length, ...structuredClone(entries));
  const snapshot = getCanonicalExerciseSnapshot();
  for (const entry of audit) {
    if (!entry.commandId) continue;
    if (entry.outcome === "ACCEPTED" && entry.eventType) results.set(entry.commandId, { ok: true, commandId: entry.commandId, snapshot, eventType: entry.eventType });
    else if (entry.rejectionCode) results.set(entry.commandId, { ok: false, commandId: entry.commandId, errorCode: entry.rejectionCode, message: "Previously rejected command" });
  }
}
