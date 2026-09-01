import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";

export type StaleRuntimeTerminalizationCode = "STALE_RUNTIME_TERMINATED" | "ALREADY_TERMINAL" | "ACTIVE_RUNTIME_PRESENT" | "CHECKPOINT_MISSING" | "CHECKPOINT_INVALID" | "CHECKPOINT_NOT_STALE" | "AUTHORIZATION_DENIED" | "INVALID_EXERCISE_LIFECYCLE" | "RECOVERY_NOT_REQUIRED" | "RECOVERY_BACKEND_FAILED";
type RecoveryRow = Readonly<{ result_code: StaleRuntimeTerminalizationCode; audit_id: string; recovered_state: SharedExerciseState | null }>;

export async function terminateStaleRuntimeAfterLeaseExpiry(client: SupabaseClient, exerciseId: string): Promise<Readonly<{ code: StaleRuntimeTerminalizationCode; state?: SharedExerciseState; auditId?: string }>> {
  const { data, error } = await client.rpc("terminate_stale_runtime_after_lease_expiry", { p_exercise_id: exerciseId });
  recordSupabaseTraffic({ operation: "RPC", endpoint: "terminate_stale_runtime_after_lease_expiry", data, fullSnapshot: true });
  if (error) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" });
  const row = (Array.isArray(data) ? data[0] : data) as RecoveryRow | undefined;
  if (!row || !row.result_code) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" });
  if (row.result_code === "STALE_RUNTIME_TERMINATED" && row.recovered_state) return Object.freeze({ code: row.result_code, state: row.recovered_state, auditId: row.audit_id });
  return Object.freeze({ code: row.result_code, ...(row.audit_id ? { auditId: row.audit_id } : {}) });
}
