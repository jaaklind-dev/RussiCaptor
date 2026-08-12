import type { Principal } from "@/models/authorization/Authorization";
import { PrincipalService } from "../PrincipalService";

const assignment = Object.freeze({ assignmentId: "A", userId: "USER-A", role: "EXCON" as const, scope: Object.freeze({ scopeType: "GLOBAL" as const }), status: "ACTIVE" as const, issuedAt: "2026-08-12T00:00:00Z", issuedBy: "ADMIN" });
describe("PrincipalService", () => {
  it("binds server assignments to the authenticated user and caches only the resolved principal", async () => {
    let stored: Principal | undefined;
    const service = new PrincipalService(
      { currentIdentity: async () => ({ state: "AUTHENTICATED" as const, identity: { userId: "USER-A" } }) } as never,
      { assignmentsFor: async () => ({ state: "VERIFIED" as const, assignments: [assignment], verifiedAt: "2026-08-12T01:00:00Z", expiresAt: "2026-08-12T01:05:00Z" }) } as never,
      { load: async () => undefined, store: async value => { stored = value; }, clear: async () => undefined },
    );
    const result = await service.resolve(); expect(result.state).toBe("AUTHENTICATED");
    if (result.state === "AUTHENTICATED") { expect(result.principal.userId).toBe("USER-A"); expect(result.principal.permissions).toEqual(["INSTRUCTOR_EVALUATION_READ", "INSTRUCTOR_EVALUATION_WRITE"]); expect(Object.isFrozen(result.principal)).toBe(true); }
    expect(stored?.userId).toBe("USER-A");
  });
  it("uses only principal-bound cached state and cached state remains fail-closed", async () => {
    const cached = Object.freeze({ userId: "USER-A", authenticationState: "AUTHENTICATED" as const, roleAssignments: [assignment], permissions: ["INSTRUCTOR_EVALUATION_READ" as const, "INSTRUCTOR_EVALUATION_WRITE" as const], authorizationFreshness: "VERIFIED_CACHED" as const, authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS" as const, verifiedAt: "2026-08-12T01:00:00Z", expiresAt: "2026-08-12T01:05:00Z" } });
    const cache = { load: jest.fn(async (userId: string) => userId === "USER-A" ? cached : undefined), store: async () => undefined, clear: async () => undefined };
    const service = new PrincipalService({ currentIdentity: async () => ({ state: "AUTHENTICATED" as const, identity: { userId: "USER-A" } }) } as never, { assignmentsFor: async () => ({ state: "UNAVAILABLE" as const }) } as never, cache);
    const result = await service.resolve(); expect(result).toMatchObject({ state: "AUTHENTICATED", principal: { userId: "USER-A", authorizationFreshness: "VERIFIED_CACHED" } }); expect(cache.load).toHaveBeenCalledWith("USER-A");
  });
  it("clears cached authority when authentication is lost", async () => {
    const cache = { load: async () => undefined, store: async () => undefined, clear: jest.fn(async () => undefined) };
    const result = await new PrincipalService({ currentIdentity: async () => ({ state: "UNAUTHENTICATED" as const }) } as never, {} as never, cache).resolve();
    expect(result).toEqual({ state: "UNAUTHENTICATED" }); expect(cache.clear).toHaveBeenCalled();
  });
});
