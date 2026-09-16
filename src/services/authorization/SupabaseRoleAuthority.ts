import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleAssignment } from "@/models/authorization/Authorization";
import { deepFreeze } from "@/utils/immutable";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";

type AssignmentRow = {
  id: string; user_id: string; role: string; scope_type: string; scope_id: string | null;
  status: string; issued_at: string; expires_at: string | null; issued_by: string;
};
type BootstrapRow = {
  id: string; user_id: string; status: string; issued_at: string; expires_at: string;
  issued_by: string; consumed_exercise_id: string | null;
};
export type RoleAuthorityResult =
  | Readonly<{ state: "VERIFIED"; assignments: readonly RoleAssignment[]; verifiedAt: string; expiresAt: string }>
  | Readonly<{ state: "UNAVAILABLE" }>;

export class SupabaseRoleAuthority {
  constructor(private readonly client: SupabaseClient, private readonly now = () => new Date(), private readonly validityMs = 5 * 60 * 1000) {}
  async assignmentsFor(userId: string): Promise<RoleAuthorityResult> {
    try {
      const [{ data, error }, { data: bootstrapData, error: bootstrapError }] = await Promise.all([
        this.client.from("authorization_role_assignments").select("id,user_id,role,scope_type,scope_id,status,issued_at,expires_at,issued_by").eq("user_id", userId),
        this.client.from("exercise_bootstrap_authorizations").select("id,user_id,status,issued_at,expires_at,issued_by,consumed_exercise_id").eq("user_id", userId),
      ]);
      recordSupabaseTraffic({ operation: "SELECT", endpoint: "authorization_role_assignments", data });
      recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_bootstrap_authorizations", data: bootstrapData });
      if (error || bootstrapError) return Object.freeze({ state: "UNAVAILABLE" });
      const rows = (data ?? []) as AssignmentRow[];
      if (rows.some(row => row.user_id !== userId || !["CM", "EXCON"].includes(row.role) || !["GLOBAL", "EXERCISE"].includes(row.scope_type) || !["ACTIVE", "REVOKED"].includes(row.status))) return Object.freeze({ state: "UNAVAILABLE" });
      const bootstrapRows = (bootstrapData ?? []) as BootstrapRow[];
      if (bootstrapRows.some(row => row.user_id !== userId || !["ACTIVE", "REVOKED"].includes(row.status)
        || typeof row.expires_at !== "string" || (row.consumed_exercise_id !== null && typeof row.consumed_exercise_id !== "string"))) {
        return Object.freeze({ state: "UNAVAILABLE" });
      }
      const assignments = [
        ...rows.map((row): RoleAssignment => deepFreeze({ assignmentId: row.id, userId: row.user_id, role: row.role as RoleAssignment["role"], scope: row.scope_type === "GLOBAL" ? { scopeType: "GLOBAL" } : { scopeType: "EXERCISE", scopeId: row.scope_id! }, status: row.status as "ACTIVE" | "REVOKED", issuedAt: row.issued_at, expiresAt: row.expires_at ?? undefined, issuedBy: row.issued_by })),
        ...bootstrapRows.map((row): RoleAssignment => deepFreeze({ assignmentId: row.id, userId: row.user_id,
          role: "EXERCISE_BOOTSTRAP", scope: { scopeType: "GLOBAL" }, status: row.status as "ACTIVE" | "REVOKED",
          issuedAt: row.issued_at, expiresAt: row.expires_at, issuedBy: row.issued_by })),
      ].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
      const now = this.now(); return deepFreeze({ state: "VERIFIED", assignments, verifiedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.validityMs).toISOString() });
    } catch { return Object.freeze({ state: "UNAVAILABLE" }); }
  }
}
