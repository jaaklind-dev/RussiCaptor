import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { ExerciseRuntimeRecoveryCommand, ExerciseRuntimeRecoveryErrorCode, ExerciseRuntimeRecoveryRepository } from "./ExerciseRuntimeRecoveryService";

type RecoveryRow = Readonly<{ result_code: string; audit_id: string; recovered_state: SharedExerciseState | null }>;
type ExerciseStateRow = Readonly<{ state: SharedExerciseState }>;
const knownCodes = new Set<ExerciseRuntimeRecoveryErrorCode>(["RECOVERY_NOT_REQUIRED", "ACTIVE_RUNTIME_WRITER_PRESENT", "RUNTIME_CHECKPOINT_AVAILABLE", "RECOVERY_NOT_AUTHORIZED", "INVALID_EXERCISE_LIFECYCLE", "RECOVERY_BACKEND_FAILED", "RECOVERY_CONFIRMATION_TIMEOUT"]);
const RECOVERY_CONFIRMATION_TIMEOUT_MS = 8_000;

function bounded<T>(operation: PromiseLike<T>, timeoutMs = RECOVERY_CONFIRMATION_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("RECOVERY_CONFIRMATION_TIMEOUT")), timeoutMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

export class SupabaseExerciseRuntimeRecoveryRepository implements ExerciseRuntimeRecoveryRepository {
  constructor(private readonly client: SupabaseClient, private readonly applyRecoveredState: (state: SharedExerciseState) => void) {}
  private async reconcileCommittedRecovery(command: ExerciseRuntimeRecoveryCommand) {
    try {
      const [{ data: stateRow, error: stateError }, { data: auditRows, error: auditError }] = await bounded(Promise.all([
        this.client.from("exercise_states").select("state").eq("exercise_id", command.exerciseId).single(),
        this.client.from("exercise_runtime_recovery_audit").select("id,result").eq("exercise_id", command.exerciseId).order("occurred_at", { ascending: false }).limit(1),
      ]));
      if (stateError || auditError) return { code: "RECOVERY_CONFIRMATION_TIMEOUT" as const };
      const state = (stateRow as ExerciseStateRow | null)?.state;
      const session = state?.exerciseSession;
      const audit = (auditRows as { id: string; result: string }[] | null)?.[0];
      if (!state || !session || !("lifecycleState" in session) || session.lifecycleState !== "COMPLETED" || audit?.result !== "RECOVERY_TERMINATED") {
        return { code: "RECOVERY_CONFIRMATION_TIMEOUT" as const };
      }
      this.applyRecoveredState(state);
      return { snapshot: session, auditId: audit.id };
    } catch {
      return { code: "RECOVERY_CONFIRMATION_TIMEOUT" as const };
    }
  }
  async terminate(command: ExerciseRuntimeRecoveryCommand) {
    let response: Awaited<ReturnType<SupabaseClient["rpc"]>>;
    try {
      response = await bounded(this.client.rpc("terminate_exercise_with_missing_runtime", {
        p_exercise_id: command.exerciseId,
        p_expected_version: command.expectedVersion,
        p_persistence_failure: command.persistenceFailure,
      }));
    } catch {
      return this.reconcileCommittedRecovery(command);
    }
    const { data, error } = response;
    if (error) return this.reconcileCommittedRecovery(command);
    const row = (Array.isArray(data) ? data[0] : data) as RecoveryRow | undefined;
    if (!row) return { code: "RECOVERY_BACKEND_FAILED" as const };
    if (row.result_code !== "RECOVERY_TERMINATED") return { code: knownCodes.has(row.result_code as ExerciseRuntimeRecoveryErrorCode) ? row.result_code as ExerciseRuntimeRecoveryErrorCode : "RECOVERY_BACKEND_FAILED" };
    if (!row.recovered_state) return { code: "RECOVERY_BACKEND_FAILED" as const };
    if (!("lifecycleState" in row.recovered_state.exerciseSession)) return { code: "RECOVERY_BACKEND_FAILED" as const };
    this.applyRecoveredState(row.recovered_state);
    return { snapshot: row.recovered_state.exerciseSession, auditId: row.audit_id };
  }
}
