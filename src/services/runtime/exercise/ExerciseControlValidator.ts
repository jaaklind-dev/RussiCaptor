import { exerciseControlCommandTypes, type ExerciseControlCommand, type ExerciseControlResult } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";

const allowedTransitions: Record<string, readonly string[]> = { START_EXERCISE: ["READY"], PAUSE_EXERCISE: ["RUNNING"], RESUME_EXERCISE: ["PAUSED"], COMPLETE_EXERCISE: ["RUNNING", "PAUSED"], SET_EXERCISE_SPEED: ["READY", "RUNNING", "PAUSED"] };
export function validateExerciseControlCommand(command: ExerciseControlCommand, snapshot: CanonicalExerciseSnapshot, activeExerciseId?: string): ExerciseControlResult | undefined {
  if (!command?.commandId?.trim() || !command.exerciseId?.trim() || !command.issuedBy?.trim() || !command.issuedAtWallClock || Number.isNaN(Date.parse(command.issuedAtWallClock))) return { ok: false, commandId: command?.commandId, errorCode: "MALFORMED_COMMAND", message: "Exercise command is malformed" };
  if (!exerciseControlCommandTypes.includes(command.commandType)) return { ok: false, commandId: command.commandId, errorCode: "MALFORMED_COMMAND", message: "Exercise command type is not supported" };
  if (!activeExerciseId) return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_NOT_FOUND", message: "Exercise is not available" };
  if (activeExerciseId !== command.exerciseId || snapshot.exerciseId !== command.exerciseId) return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_NOT_ACTIVE", message: "Exercise is not active" };
  if (command.issuedBy !== "Exercise Controller") return { ok: false, commandId: command.commandId, errorCode: "UNAUTHORIZED", message: "Exercise Controller authorization is required" };
  if (command.expectedVersion !== undefined && command.expectedVersion !== snapshot.version) return { ok: false, commandId: command.commandId, errorCode: "VERSION_CONFLICT", message: "Exercise snapshot version has changed" };
  if (!allowedTransitions[command.commandType].includes(snapshot.lifecycleState)) return { ok: false, commandId: command.commandId, errorCode: "INVALID_TRANSITION", message: `${command.commandType} is invalid while ${snapshot.lifecycleState}` };
  const payloadKeys = Object.keys(command.payload ?? {});
  if (command.commandType === "SET_EXERCISE_SPEED") {
    if (payloadKeys.some(key => key !== "speed") || ![1, 2, 4].includes(Number(command.payload?.speed))) return { ok: false, commandId: command.commandId, errorCode: "INVALID_SPEED", message: "Speed must be ×1, ×2, or ×4" };
  } else if (payloadKeys.length > 0) return { ok: false, commandId: command.commandId, errorCode: "MALFORMED_COMMAND", message: "Lifecycle commands do not accept a payload" };
  return undefined;
}
