import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { exconRouteRedirect, resolveExconRouteReadiness, type CurrentExerciseDiscoveryReadiness } from "../ExconRouteReadinessService";
import { resolveSelectedModeNavigationTarget, resolveSelectedModeRoute } from "../OperatorRouteService";

const exerciseId = "EX-1792248579668-1";
const operator = (admin = false, scoped = true): OperatorSessionState => ({
  state: "AUTHENTICATED", isPlatformAdmin: admin, profile: { userId: "LOCAL-FIXTURE", displayName: "Synthetic" },
  principal: { userId: "LOCAL-FIXTURE", authenticationState: "AUTHENTICATED", permissions: [],
    authorizationFreshness: "VERIFIED_ONLINE", authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS",
      verifiedAt: "2026-10-17T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
    roleAssignments: scoped ? [{ assignmentId: "FIXTURE-EXCON", userId: "LOCAL-FIXTURE", role: "EXCON",
      scope: { scopeType: "EXERCISE", scopeId: exerciseId }, status: "ACTIVE", issuedBy: "FIXTURE",
      issuedAt: "2026-10-17T00:00:00Z" }] : [] },
});
const readiness = (discovery: CurrentExerciseDiscoveryReadiness, state = operator()) =>
  resolveExconRouteReadiness({ operator: state, mode: { userId: "LOCAL-FIXTURE", selectedMode: "EXCON" },
    currentExerciseId: exerciseId, discovery });

describe("production EXCON entry and protected-route agreement", () => {
  test("before-fix role-only routing contradicts the protected route; fixed routing is stable", () => {
    const denied = readiness("UNAVAILABLE");
    expect(exconRouteRedirect(denied)).toBe("/mode");
    // Historical role-only branch returned /excon here, producing a two-route cycle.
    expect(resolveSelectedModeRoute(operator(), "EXCON", exerciseId, denied)).toBe("/mode");
    for (let mount = 0; mount < 100; mount++) {
      expect(resolveSelectedModeNavigationTarget(operator(), "EXCON", exerciseId, "/mode", denied)).toBeUndefined();
    }
  });
  test.each(["PENDING", "UNAVAILABLE", "CONFLICT"] as const)("%s never automatically enters EXCON", discovery => {
    expect(resolveSelectedModeRoute(operator(), "EXCON", exerciseId, readiness(discovery))).toBe("/mode");
  });
  test("later resolved discovery resumes normal navigation without a role or runtime change", () => {
    const state = operator();
    expect(resolveSelectedModeRoute(state, "EXCON", exerciseId, readiness("UNAVAILABLE", state))).toBe("/mode");
    const ready = readiness("RESOLVED", state);
    expect(resolveSelectedModeRoute(state, "EXCON", exerciseId, ready)).toBe("/excon");
    expect(exconRouteRedirect(ready)).toBeUndefined();
  });
  test("ADMIN is independent of EXCON discovery, including accounts with both authorities", () => {
    expect(resolveSelectedModeRoute(operator(true), "ADMIN", exerciseId, readiness("UNAVAILABLE"))).toBe("/admin");
    expect(resolveSelectedModeRoute(operator(true), "EXCON", exerciseId, readiness("UNAVAILABLE"))).toBe("/mode");
  });
  test("missing/wrong role and missing/mismatched readiness cannot authorize entry", () => {
    expect(resolveSelectedModeRoute(operator(true, false), "EXCON", exerciseId, readiness("RESOLVED"))).toBe("/mode");
    expect(resolveSelectedModeRoute(operator(), "EXCON", "OTHER", readiness("RESOLVED"))).toBe("/mode");
    expect(resolveSelectedModeRoute(operator(), "EXCON", exerciseId)).toBe("/mode");
    expect(resolveSelectedModeRoute({ state: "UNAUTHENTICATED" }, "EXCON", exerciseId, readiness("RESOLVED"))).toBe("/mode");
    expect(resolveSelectedModeRoute(operator(), "CM", exerciseId)).toBe("/mode");
  });
  test("restored EXCON preference still waits for fresh discovery", () => {
    const restored = operator();
    expect(resolveSelectedModeRoute(restored, "EXCON", exerciseId, readiness("PENDING", restored))).toBe("/mode");
    expect(resolveSelectedModeRoute(restored, "EXCON", exerciseId, readiness("RESOLVED", restored))).toBe("/excon");
  });
});
