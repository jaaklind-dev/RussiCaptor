import type { Principal, PrincipalState, RoleAssignment } from "@/models/authorization/Authorization";
import { AuthorizationService } from "../AuthorizationService";
import { getAuthorizationAudit, resetAuthorizationAudit } from "../AuthorizationAuditService";
import { permissionsForRole, resolvePermissions } from "../PermissionResolver";

const globalAssignment = (overrides: Partial<RoleAssignment> = {}): RoleAssignment => Object.freeze({
  assignmentId: "A-1", userId: "USER-A", role: "EXCON", scope: Object.freeze({ scopeType: "GLOBAL" }),
  status: "ACTIVE", issuedAt: "2026-08-12T00:00:00.000Z", issuedBy: "ADMIN", ...overrides,
});
const principal = (assignments: readonly RoleAssignment[], freshness: Principal["authorizationFreshness"] = "VERIFIED_ONLINE"): Principal => Object.freeze({
  userId: "USER-A", authenticationState: "AUTHENTICATED", roleAssignments: Object.freeze([...assignments]),
  permissions: resolvePermissions(assignments), authorizationFreshness: freshness,
  authorizationProvenance: Object.freeze({ authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-08-12T01:05:00.000Z" }),
});
const state = (value: Principal): PrincipalState => Object.freeze({ state: "AUTHENTICATED", principal: value });

describe("WP-41A authorization foundation", () => {
  beforeEach(resetAuthorizationAudit);
  it("resolves EXCON permissions canonically, recursively immutable and independent of assignment order", () => {
    const exercise: RoleAssignment = { ...globalAssignment({ assignmentId: "A-2" }), scope: { scopeType: "EXERCISE", scopeId: "EX-1" } };
    const first = resolvePermissions([exercise, globalAssignment()], { exerciseId: "EX-1" });
    const second = resolvePermissions([globalAssignment(), exercise], { exerciseId: "EX-1" });
    expect(first).toEqual(["INSTRUCTOR_EVALUATION_READ", "INSTRUCTOR_EVALUATION_WRITE"]); expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true); expect(permissionsForRole("EXCON")).toEqual(first);
  });
  it("authorizes authenticated online EXCON for independent read and write permissions", async () => {
    const service = new AuthorizationService(); const value = state(principal([globalAssignment()]));
    expect((await service.authorize(value, "INSTRUCTOR_EVALUATION_READ", { exerciseId: "EX-1" })).status).toBe("AUTHORIZED");
    expect((await service.authorize(value, "INSTRUCTOR_EVALUATION_WRITE", { exerciseId: "EX-1" })).status).toBe("AUTHORIZED");
  });
  it("fails closed for unauthenticated, unavailable, no-role, cached and stale states", async () => {
    const service = new AuthorizationService();
    expect((await service.authorize({ state: "UNAUTHENTICATED" }, "INSTRUCTOR_EVALUATION_WRITE")).status).toBe("DENIED");
    expect((await service.authorize({ state: "UNAVAILABLE", userId: "A" }, "INSTRUCTOR_EVALUATION_WRITE")).status).toBe("DENIED");
    await expect(service.authorize(state(principal([])), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "ROLE_NOT_ASSIGNED" });
    await expect(service.authorize(state(principal([globalAssignment()], "VERIFIED_CACHED")), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "AUTHORIZATION_STALE" });
    await expect(service.authorize(state(principal([globalAssignment()], "STALE")), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "AUTHORIZATION_STALE" });
  });
  it("denies scope mismatch, revoked and expired assignment", async () => {
    const service = new AuthorizationService();
    const scoped: RoleAssignment = { ...globalAssignment(), scope: { scopeType: "EXERCISE", scopeId: "EX-1" } };
    await expect(service.authorize(state(principal([scoped])), "INSTRUCTOR_EVALUATION_WRITE", { exerciseId: "EX-2" })).resolves.toMatchObject({ status: "DENIED", reason: "SCOPE_MISMATCH" });
    await expect(service.authorize(state(principal([globalAssignment({ status: "REVOKED" })])), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "ROLE_NOT_ASSIGNED" });
    await expect(service.authorize(state(principal([globalAssignment({ expiresAt: "2026-08-12T00:30:00.000Z" })])), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "ROLE_NOT_ASSIGNED" });
  });
  it("does not treat UI mode or forged local labels as authorization", async () => {
    const forged = { state: "AUTHENTICATED", principal: principal([]), uiMode: "EXCON", role: "EXCON" } as PrincipalState;
    await expect(new AuthorizationService().authorize(forged, "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "ROLE_NOT_ASSIGNED" });
  });
  it("attributes authorization decisions without tokens or clinical Timeline data", async () => {
    await new AuthorizationService(undefined, () => "2026-08-12T01:00:00.000Z").authorize(state(principal([globalAssignment()])), "INSTRUCTOR_EVALUATION_WRITE", { exerciseId: "EX-1" });
    expect(getAuthorizationAudit()).toEqual([expect.objectContaining({ userId: "USER-A", permission: "INSTRUCTOR_EVALUATION_WRITE", exerciseId: "EX-1", decision: "AUTHORIZED", occurredAt: "2026-08-12T01:00:00.000Z" })]);
    expect(JSON.stringify(getAuthorizationAudit())).not.toMatch(/token|jwt|refresh/i);
  });
  it("fails closed when mandatory authorization audit cannot be persisted", async () => {
    const service = new AuthorizationService({ append: async () => { throw new Error("offline"); } });
    await expect(service.authorize(state(principal([globalAssignment()])), "INSTRUCTOR_EVALUATION_WRITE")).resolves.toMatchObject({ status: "DENIED", reason: "AUTHORIZATION_UNAVAILABLE" });
  });
});
