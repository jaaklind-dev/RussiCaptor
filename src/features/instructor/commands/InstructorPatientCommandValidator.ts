import { instructorEventTypes, type InstructorCommandResult, type InstructorPatientCommand } from "@/models/InstructorCommand";
import type { InstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import type { ExerciseLifecycleState } from "@/models/exercise/CanonicalExerciseSnapshot";
const forbiddenPayloadKeys = new Set(["heartRate", "hr", "spo2", "respiratoryRate", "rr", "systolicBloodPressure", "sbp", "diastolicBloodPressure", "dbp", "gcs", "avpu"]);
export function validateInstructorPatientCommand(command: InstructorPatientCommand, context: { activeExerciseId?: string; exerciseLifecycleState?: ExerciseLifecycleState; patientExists: boolean; patientBelongsToExercise: boolean; runtimeOwner?: InstructorRuntimeOwner }): InstructorCommandResult | undefined {
  if (!command || !command.commandId?.trim() || !command.exerciseId?.trim() || !command.patientId?.trim() || !command.issuedBy?.trim() || !Number.isFinite(command.issuedAtSimulationTime) || command.issuedAtSimulationTime < 0 || !command.issuedAtWallClock || Number.isNaN(Date.parse(command.issuedAtWallClock))) return { ok: false, commandId: command?.commandId, errorCode: "MALFORMED_COMMAND", message: "Command is malformed" };
  if (!instructorEventTypes.includes(command.eventType)) return { ok: false, commandId: command.commandId, errorCode: "UNSUPPORTED_EVENT", message: "Event is not in the instructor catalogue" };
  if (!context.activeExerciseId) return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_NOT_FOUND", message: "Exercise is not available" };
  if (context.activeExerciseId !== command.exerciseId) return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_NOT_ACTIVE", message: "Exercise is not active" };
  if (context.exerciseLifecycleState === "READY") return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_NOT_RUNNING", message: "Exercise has not started" };
  if (context.exerciseLifecycleState === "PAUSED") return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_PAUSED", message: "Exercise is paused" };
  if (context.exerciseLifecycleState === "COMPLETED") return { ok: false, commandId: command.commandId, errorCode: "EXERCISE_COMPLETED", message: "Exercise is completed" };
  if (!context.patientExists) return { ok: false, commandId: command.commandId, errorCode: "PATIENT_NOT_FOUND", message: "Patient was not found" };
  if (!context.patientBelongsToExercise) return { ok: false, commandId: command.commandId, errorCode: "PATIENT_EXERCISE_MISMATCH", message: "Patient does not belong to the exercise" };
  const payload = command.payload ?? {};
  if (Object.keys(payload).some(item => forbiddenPayloadKeys.has(item)) || Object.keys(payload).length > 0) return { ok: false, commandId: command.commandId, errorCode: "INVALID_PAYLOAD", message: "Direct values and event payloads are not permitted in IC-3" };
  if (!context.runtimeOwner || !context.runtimeOwner.supportedEvents.includes(command.eventType)) return { ok: false, commandId: command.commandId, errorCode: "UNSUPPORTED_STATE", message: "Event is not supported for this patient" };
  return undefined;
}
