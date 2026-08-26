import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizationAuditEntry } from "@/models/authorization/Authorization";
import type { AuthorizationAuditSink } from "./AuthorizationAuditService";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";

/** Protected writes must couple this audit with their backend mutation in a trusted RPC. */
export class SupabaseAuthorizationAuditSink implements AuthorizationAuditSink {
  constructor(private readonly client: SupabaseClient) {}
  async append(entry: AuthorizationAuditEntry): Promise<void> {
    const { error } = await this.client.rpc("record_authorization_decision", { p_permission: entry.permission, p_exercise_id: entry.exerciseId ?? null, p_operation: "AUTHORIZATION_CHECK" });
    recordSupabaseTraffic({ operation: "RPC", endpoint: "record_authorization_decision" });
    if (error) throw new Error("Authorization audit persistence failed.");
  }
}
