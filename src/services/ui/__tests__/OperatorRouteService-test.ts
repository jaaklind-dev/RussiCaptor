import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { resolveOperatorLandingNavigationTarget, resolveOperatorLandingRoute } from "../OperatorRouteService";

function authenticated(role: "CM" | "EXCON" | "EXERCISE_BOOTSTRAP", scopeId?: string): OperatorSessionState {
  return {
    state: "AUTHENTICATED",
    profile: { userId: "USER-1", displayName: "Test Operator" },
    principal: {
      userId: "USER-1", authenticationState: "AUTHENTICATED",
      roleAssignments: [{ assignmentId: "ROLE-1", userId: "USER-1", role,
        scope: scopeId ? { scopeType: "EXERCISE", scopeId } : { scopeType: "GLOBAL" },
        status: "ACTIVE", issuedAt: "2026-08-29T00:00:00.000Z", issuedBy: "ADMIN" }],
      permissions: [], authorizationFreshness: "VERIFIED_ONLINE",
      authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-08-29T00:00:00.000Z", expiresAt: "2026-08-29T01:00:00.000Z" },
    },
  };
}

describe("operator landing route", () => {
  test("routes an exercise-scoped CM to the dashboard for the current exercise", () => {
    expect(resolveOperatorLandingRoute(authenticated("CM", "EX-1"), "EX-1")).toBe("/dashboard");
  });
  test("routes an exercise-scoped EXCON to EXCON for the current exercise", () => {
    expect(resolveOperatorLandingRoute(authenticated("EXCON", "EX-1"), "EX-1")).toBe("/excon");
  });
  test("routes a one-shot exercise bootstrap operator only to the EXCON preparation surface", () => {
    expect(resolveOperatorLandingRoute(authenticated("EXERCISE_BOOTSTRAP"), "EX-OLD")).toBe("/excon");
  });
  test("fails closed for a role scoped to another exercise", () => {
    expect(resolveOperatorLandingRoute(authenticated("CM", "EX-2"), "EX-1")).toBe("/");
  });
  test("does not replace the login route with itself while scoped exercise discovery is pending", () => {
    expect(resolveOperatorLandingNavigationTarget(authenticated("CM", "EX-2"), "EX-1")).toBeUndefined();
    expect(resolveOperatorLandingNavigationTarget(authenticated("CM", "EX-1"), "EX-1")).toBe("/dashboard");
    expect(resolveOperatorLandingNavigationTarget(authenticated("EXCON", "EX-1"), "EX-1")).toBe("/excon");
    expect(resolveOperatorLandingNavigationTarget(authenticated("EXCON", "EX-1"), "EX-1", "/excon")).toBeUndefined();
  });
});
