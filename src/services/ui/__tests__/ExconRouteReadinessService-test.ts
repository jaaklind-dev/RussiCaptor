import type { RoleAssignment } from "@/models/authorization/Authorization";
import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import fs from "node:fs";
import path from "node:path";
import type { OperatorModeSnapshot } from "../OperatorModeService";
import {
  exconRouteRedirect,
  resolveExconRouteReadiness,
  type CurrentExerciseDiscoveryReadiness,
} from "../ExconRouteReadinessService";

const targetExercise = "EX-1790195546779-1";

function assignment(
  exerciseId = targetExercise,
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  return Object.freeze({
    assignmentId: `EXCON-${exerciseId}`,
    userId: "USER-1",
    role: "EXCON",
    scope: { scopeType: "EXERCISE" as const, scopeId: exerciseId },
    status: "ACTIVE",
    issuedAt: "2026-10-01T00:00:00.000Z",
    issuedBy: "ADMIN",
    expiresAt: "2099-10-01T00:00:00.000Z",
    ...overrides,
  });
}

function authenticated(
  assignments: readonly RoleAssignment[] = [assignment()],
  admin = false,
): OperatorSessionState {
  return {
    state: "AUTHENTICATED",
    profile: { userId: "USER-1", displayName: "Test Operator" },
    isPlatformAdmin: admin,
    principal: {
      userId: "USER-1",
      authenticationState: "AUTHENTICATED",
      roleAssignments: assignments,
      permissions: [],
      authorizationFreshness: "VERIFIED_ONLINE",
      authorizationProvenance: {
        authority: "SUPABASE_ROLE_ASSIGNMENTS",
        verifiedAt: "2026-10-01T00:00:00.000Z",
        expiresAt: "2099-10-01T00:00:00.000Z",
      },
    },
  };
}

const selectedMode: OperatorModeSnapshot = Object.freeze({ userId: "USER-1", selectedMode: "EXCON" });

function resolve(overrides: Partial<Readonly<{
  operator: OperatorSessionState;
  mode: OperatorModeSnapshot;
  currentExerciseId: string;
  discovery: CurrentExerciseDiscoveryReadiness;
}>> = {}) {
  return resolveExconRouteReadiness({
    operator: authenticated(),
    mode: selectedMode,
    currentExerciseId: targetExercise,
    discovery: "RESOLVED",
    ...overrides,
  });
}

describe("EXCON workbench route readiness", () => {
  test("EXCON-ROUTE-01 auth pending does not redirect dashboard", () => {
    const result = resolve({ operator: { state: "LOADING" }, mode: {} });
    expect(result).toEqual({ state: "PENDING", reason: "AUTHORITY" });
    expect(exconRouteRedirect(result)).toBeUndefined();
  });

  test("EXCON-ROUTE-02 role authority pending remains fail-closed without redirect", () => {
    const result = resolve({ operator: { state: "LOADING" }, mode: selectedMode });
    expect(result.state).toBe("PENDING");
    expect(result.state === "AUTHORIZED").toBe(false);
  });

  test("EXCON-ROUTE-03 current-exercise pending does not redirect dashboard", () => {
    const result = resolve({ currentExerciseId: "demo", discovery: "PENDING" });
    expect(result).toEqual({
      state: "PENDING",
      reason: "CURRENT_EXERCISE",
      intendedExerciseId: targetExercise,
    });
    expect(exconRouteRedirect(result)).toBeUndefined();
  });

  test("EXCON-ROUTE-04 valid scoped EXCON eventually authorizes dashboard", () => {
    expect(resolve()).toEqual({
      state: "AUTHORIZED",
      exerciseId: targetExercise,
      intendedExerciseId: targetExercise,
    });
  });

  test("EXCON-ROUTE-05 confirmed missing EXCON redirects safely", () => {
    const result = resolve({ operator: authenticated([], true) });
    expect(result).toMatchObject({ state: "DENIED", reason: "ROLE_MISSING" });
    expect(exconRouteRedirect(result)).toBe("/mode");
  });

  test("EXCON-ROUTE-06 expired or revoked EXCON redirects safely", () => {
    for (const role of [assignment(targetExercise, { status: "REVOKED" }),
      assignment(targetExercise, { expiresAt: "2026-01-01T00:00:00.000Z" })]) {
      expect(resolve({ operator: authenticated([role], true) })).toMatchObject({
        state: "DENIED",
        reason: "ROLE_MISSING",
      });
    }
  });

  test("EXCON-ROUTE-07 intended exercise context survives hydration", () => {
    const pending = resolve({ currentExerciseId: "demo", discovery: "PENDING" });
    const ready = resolve({ currentExerciseId: targetExercise, discovery: "RESOLVED" });
    expect(pending.intendedExerciseId).toBe(targetExercise);
    expect(ready.intendedExerciseId).toBe(targetExercise);
  });

  test("EXCON-ROUTE-08 cold start restores dashboard after readiness", () => {
    expect(resolve({ operator: { state: "LOADING" }, mode: {}, currentExerciseId: "demo", discovery: "PENDING" }).state)
      .toBe("PENDING");
    expect(resolve({ currentExerciseId: "demo", discovery: "PENDING" }).state).toBe("PENDING");
    expect(resolve().state).toBe("AUTHORIZED");
  });

  test("EXCON-ROUTE-09 warm navigation remains authorized", () => {
    expect(resolve().state).toBe("AUTHORIZED");
    expect(exconRouteRedirect(resolve())).toBeUndefined();
  });

  test("EXCON-ROUTE-10 Admin to EXCON mode switch waits for mode reconciliation", () => {
    const admin = authenticated([assignment()], true);
    expect(resolve({ operator: admin, mode: { userId: "USER-1", selectedMode: "ADMIN" } }))
      .toMatchObject({ state: "DENIED", reason: "MODE_NOT_SELECTED" });
    expect(resolve({ operator: admin, mode: selectedMode, currentExerciseId: "demo", discovery: "PENDING" }).state)
      .toBe("PENDING");
    expect(resolve({ operator: admin, mode: selectedMode }).state).toBe("AUTHORIZED");
  });

  test("EXCON-ROUTE-11 restored EXCON last-mode waits only for exercise discovery", () => {
    expect(resolve({ currentExerciseId: "demo", discovery: "PENDING" })).toMatchObject({
      state: "PENDING",
      reason: "CURRENT_EXERCISE",
    });
  });

  test("EXCON-ROUTE-12 legacy exercise hydrates without a new-package requirement", () => {
    expect(resolve({ currentExerciseId: targetExercise })).toMatchObject({
      state: "AUTHORIZED",
      exerciseId: targetExercise,
    });
  });

  test("EXCON-ROUTE-13 pending state does not become optimistic authorization", () => {
    const result = resolve({ currentExerciseId: "demo", discovery: "PENDING" });
    expect(result.state).not.toBe("AUTHORIZED");
  });

  test("EXCON-ROUTE-14 confirmed exercise-not-found redirects with bounded reason", () => {
    const result = resolve({ currentExerciseId: "OTHER", discovery: "RESOLVED" });
    expect(result).toEqual({
      state: "DENIED",
      reason: "EXERCISE_UNAVAILABLE",
      intendedExerciseId: targetExercise,
    });
    expect(exconRouteRedirect(result)).toBe("/mode");
  });

  test("EXCON-ROUTE-15 pending and authorized decisions cannot create a redirect loop", () => {
    expect(exconRouteRedirect(resolve({ currentExerciseId: "demo", discovery: "PENDING" }))).toBeUndefined();
    expect(exconRouteRedirect(resolve())).toBeUndefined();
  });

  test("route tree wires the shared readiness policy before mounting EXCON workbench actions", () => {
    const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
    expect(read("app/_layout.tsx")).toContain("exconRouteRedirect(exconReadiness)");
    expect(read("app/excon/dashboard.tsx")).toContain("<ExconRouteReadinessBoundary readiness={readiness}>");
    expect(read("app/excon/index.tsx")).toContain("<ExconRouteReadinessBoundary readiness={readiness}>");
  });
});
