import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { ExerciseRuntimeRecoveryCommand, ExerciseRuntimeRecoveryErrorCode, ExerciseRuntimeRecoveryRepository } from "./ExerciseRuntimeRecoveryService";

type RecoveryRow = Readonly<{ result_code: string; audit_id: string; recovered_state: SharedExerciseState | null }>;
const knownCodes = new Set<ExerciseRuntimeRecoveryErrorCode>(["RECOVERY_NOT_REQUIRED", "ACTIVE_RUNTIME_WRITER_PRESENT", "RUNTIME_CHECKPOINT_AVAILABLE", "RECOVERY_NOT_AUTHORIZED", "INVALID_EXERCISE_LIFECYCLE", "RECOVERY_BACKEND_FAILED"]);

export class SupabaseExerciseRuntimeRecoveryRepository implements ExerciseRuntimeRecoveryRepository {
  constructor(private readonly client: SupabaseClient, private readonly applyRecoveredState: (state: SharedExerciseState) => void) {}
  async terminate(command: ExerciseRuntimeRecoveryCommand) {
    const { data, error } = await this.client.rpc("terminate_exercise_with_missing_runtime", {
      p_exercise_id: command.exerciseId,
      p_expected_version: command.expectedVersion,
      p_persistence_failure: command.persistenceFailure,
    });
    if (error) return { code: "RECOVERY_BACKEND_FAILED" as const };
    const row = (Array.isArray(data) ? data[0] : data) as RecoveryRow | undefined;
    if (!row) return { code: "RECOVERY_BACKEND_FAILED" as const };
    if (row.result_code !== "RECOVERY_TERMINATED") return { code: knownCodes.has(row.result_code as ExerciseRuntimeRecoveryErrorCode) ? row.result_code as ExerciseRuntimeRecoveryErrorCode : "RECOVERY_BACKEND_FAILED" };
    if (!row.recovered_state) return { code: "RECOVERY_BACKEND_FAILED" as const };
    if (!("lifecycleState" in row.recovered_state.exerciseSession)) return { code: "RECOVERY_BACKEND_FAILED" as const };
    this.applyRecoveredState(row.recovered_state);
    return { snapshot: row.recovered_state.exerciseSession, auditId: row.audit_id };
  }
}
