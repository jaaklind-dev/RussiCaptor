import { SupabaseAuthenticationAdapter } from "@/services/authorization/SupabaseAuthenticationAdapter";
import { AuthorizationService } from "@/services/authorization/AuthorizationService";
import { permissionsForRole, resolvePermissions } from "@/services/authorization/PermissionResolver";
import type { PrincipalState, RoleAssignment } from "@/models/authorization/Authorization";

const assignment = (role: "CM" | "EXCON", scopeId = "EX-1", overrides: Partial<RoleAssignment> = {}): RoleAssignment => {
  const base: RoleAssignment = { assignmentId: `${role}-1`, userId: "USER-1", role, scope: { scopeType: "EXERCISE", scopeId }, status: "ACTIVE", issuedAt: "2026-08-29T00:00:00.000Z", issuedBy: "ADMIN" };
  return Object.freeze({ ...base, ...overrides });
};
const principal = (roles: readonly RoleAssignment[]): PrincipalState => ({ state: "AUTHENTICATED", principal: {
  userId: "USER-1", authenticationState: "AUTHENTICATED", roleAssignments: roles,
  permissions: [...new Set(roles.flatMap(item => permissionsForRole(item.role)))].sort(), authorizationFreshness: "VERIFIED_ONLINE",
  authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-08-29T01:00:00.000Z", expiresAt: "2026-08-29T01:05:00.000Z" },
} });

describe("WP-NEXT-02 production operator identity", () => {
  test("anonymous Supabase identity is never accepted as an operator", async () => {
    const adapter = new SupabaseAuthenticationAdapter({ auth: {
      getSession: async () => ({ data: { session: { expires_at: 2_000_000_000 } }, error: null }),
      getUser: async () => ({ data: { user: { id: "ANON", is_anonymous: true } }, error: null }),
    } } as never);
    await expect(adapter.currentIdentity()).resolves.toEqual({ state: "UNAUTHENTICATED" });
  });

  test("stable auth uid is authoritative and display metadata is not consulted", async () => {
    const adapter = new SupabaseAuthenticationAdapter({ auth: {
      getSession: async () => ({ data: { session: { expires_at: 2_000_000_000 } }, error: null }),
      getUser: async () => ({ data: { user: { id: "USER-1", email: "operator@example.test", is_anonymous: false, user_metadata: { role: "EXCON", display_name: "Spoof" } } }, error: null }),
    } } as never);
    await expect(adapter.currentIdentity()).resolves.toMatchObject({ state: "AUTHENTICATED", identity: { userId: "USER-1", email: "operator@example.test", isAnonymous: false } });
  });

  test("CM may join and write only its assigned exercise and cannot control EXCON", async () => {
    const auth = new AuthorizationService({ append: async () => undefined }, () => "2026-08-29T01:00:00.000Z");
    await expect(auth.authorize(principal([assignment("CM")]), "CM_WORKFLOW_WRITE", { exerciseId: "EX-1" })).resolves.toMatchObject({ status: "AUTHORIZED" });
    await expect(auth.authorize(principal([assignment("CM")]), "EXCON_EXERCISE_CONTROL", { exerciseId: "EX-1" })).resolves.toMatchObject({ status: "DENIED", reason: "PERMISSION_DENIED" });
    await expect(auth.authorize(principal([assignment("CM")]), "CM_WORKFLOW_WRITE", { exerciseId: "EX-2" })).resolves.toMatchObject({ status: "DENIED", reason: "SCOPE_MISMATCH" });
  });

  test("exercise-scoped EXCON is allowed only for matching exercise", async () => {
    const auth = new AuthorizationService({ append: async () => undefined }, () => "2026-08-29T01:00:00.000Z");
    await expect(auth.authorize(principal([assignment("EXCON")]), "EXCON_EXERCISE_CONTROL", { exerciseId: "EX-1" })).resolves.toMatchObject({ status: "AUTHORIZED" });
    await expect(auth.authorize(principal([assignment("EXCON")]), "EXERCISE_RUNTIME_RECOVERY", { exerciseId: "EX-2" })).resolves.toMatchObject({ status: "DENIED", reason: "SCOPE_MISMATCH" });
  });

  test("expired and revoked assignments fail closed", async () => {
    const auth = new AuthorizationService({ append: async () => undefined }, () => "2026-08-29T01:00:00.000Z");
    await expect(auth.authorize(principal([assignment("CM", "EX-1", { status: "REVOKED" })]), "CM_WORKFLOW_WRITE", { exerciseId: "EX-1" })).resolves.toMatchObject({ status: "DENIED" });
    await expect(auth.authorize(principal([assignment("EXCON", "EX-1", { expiresAt: "2026-08-29T00:30:00.000Z" })]), "EXCON_EXERCISE_CONTROL", { exerciseId: "EX-1" })).resolves.toMatchObject({ status: "DENIED" });
  });

  test("CM permission resolution is deterministic", () => {
    expect(resolvePermissions([assignment("CM")], { exerciseId: "EX-1" })).toEqual(["CM_WORKFLOW_WRITE", "EXERCISE_JOIN"]);
  });
});
