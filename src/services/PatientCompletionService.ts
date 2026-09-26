import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { runtimePatientCommandSubmissionReadiness, submitPatientRuntimeCommand,
  waitForPatientRuntimeCommandResult } from "@/services/runtime/commands/RuntimePatientCommandService";

export type PatientCompletionSubmissionResult = Readonly<{
  status: "PENDING" | "IDEMPOTENT" | "REJECTED";
  commandId: string;
  reason?: string;
}>;

export async function submitPatientCompletion(commandId: string,
  patientId: string): Promise<PatientCompletionSubmissionResult> {
  const exercise = getCanonicalExerciseSnapshot();
  const readiness = runtimePatientCommandSubmissionReadiness(exercise.exerciseId, exercise.simulationTimeSec);
  if (!readiness.ready) return Object.freeze({ status: "REJECTED", commandId,
    reason: readiness.reason ?? "COMMAND_NOT_READY" });
  const result = await submitPatientRuntimeCommand({ exerciseId: exercise.exerciseId, patientId, commandId,
    commandType: "PATIENT_COMPLETE", simulationTimeSec: exercise.simulationTimeSec, payload: Object.freeze({}) });
  if (result.status !== "APPLIED" && result.status !== "IDEMPOTENT") {
    return Object.freeze({ status: "REJECTED", commandId, reason: result.status });
  }
  if (result.commandSequence !== undefined) {
    const materialized = await waitForPatientRuntimeCommandResult(exercise.exerciseId, result.commandSequence);
    if (materialized?.status === "REJECTED") return Object.freeze({ status: "REJECTED", commandId,
      reason: typeof materialized.result.reason === "string" ? materialized.result.reason : "RUNTIME_MATERIALIZATION_FAILURE" });
  }
  return Object.freeze({ status: result.status === "IDEMPOTENT" ? "IDEMPOTENT" : "PENDING", commandId });
}

let completionCommandSequence = 0;
export function createPatientCompletionCommandId(exerciseId: string, patientId: string): string {
  completionCommandSequence += 1;
  return `PATIENT_COMPLETE:${exerciseId}:${patientId}:${completionCommandSequence}`;
}
