/* eslint-disable import/first */
import type { RoleAssignment } from "@/models/authorization/Authorization";
import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";

const mockPrepareRuntimeExit = jest.fn(async () => undefined);
const mockCompleteRuntimeExit = jest.fn();
jest.mock("@/services/authorization/OperatorSignOutLifecycle", () => ({
  prepareOperatorRuntimeExit: () => mockPrepareRuntimeExit(),
  completeOperatorRuntimeExitDrain: () => mockCompleteRuntimeExit(),
}));

import {
  getOperatorModeSnapshot,
  reconcileOperatorMode,
  resetOperatorModeForTests,
  resolveAvailableUserModes,
  selectOperatorMode,
  switchOperatorMode,
} from "../OperatorModeService";

const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};

function assignment(role: "CM" | "EXCON", exerciseId: string, overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return Object.freeze({
    assignmentId: `${role}-${exerciseId}`, userId: "USER-1", role,
    scope: { scopeType: "EXERCISE" as const, scopeId: exerciseId }, status: "ACTIVE",
    issuedAt: "2026-10-01T00:00:00.000Z", issuedBy: "ADMIN", ...overrides,
  });
}

function authenticated(assignments: readonly RoleAssignment[] = [], admin = false): OperatorSessionState {
  return {
    state: "AUTHENTICATED", profile: { userId: "USER-1", displayName: "Test" }, isPlatformAdmin: admin,
    principal: { userId: "USER-1", authenticationState: "AUTHENTICATED", roleAssignments: assignments,
      permissions: [], authorizationFreshness: "VERIFIED_ONLINE",
      authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-01T01:00:00.000Z" } },
  };
}

describe("ROLE-MODE-SWITCHER-01 authority and preference", () => {
  beforeAll(() => { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageStub }); });
  beforeEach(() => { storage.clear(); resetOperatorModeForTests(); mockPrepareRuntimeExit.mockReset(); mockPrepareRuntimeExit.mockResolvedValue(undefined); mockCompleteRuntimeExit.mockReset(); });

  test("MODE-AUTH-01/04/05 Admin authority does not invent CM or EXCON", () => {
    expect(resolveAvailableUserModes(authenticated([], true))).toEqual([{ mode: "ADMIN", exerciseIds: [] }]);
  });

  test("MODE-AUTH-02/03/06/07 exposes only explicitly assigned scoped modes", () => {
    expect(resolveAvailableUserModes(authenticated([assignment("CM", "EX-A")], false)))
      .toEqual([{ mode: "CM", exerciseIds: ["EX-A"] }]);
    expect(resolveAvailableUserModes(authenticated([assignment("EXCON", "EX-B")], false)))
      .toEqual([{ mode: "EXCON", exerciseIds: ["EX-B"] }]);
  });

  test("MODE-AUTH-08 keeps exercise scopes distinct and ignores GLOBAL operational roles", () => {
    const global = { ...assignment("CM", "EX-A"), scope: { scopeType: "GLOBAL" as const } };
    expect(resolveAvailableUserModes(authenticated([assignment("CM", "EX-B"), assignment("CM", "EX-A"),
      assignment("EXCON", "EX-C"), global], true))).toEqual([
      { mode: "ADMIN", exerciseIds: [] },
      { mode: "CM", exerciseIds: ["EX-A", "EX-B"] },
      { mode: "EXCON", exerciseIds: ["EX-C"] },
    ]);
  });

  test("MODE-AUTH-09 revoked and expired assignments disappear after reconciliation", () => {
    const state = authenticated([
      assignment("CM", "EX-A"),
      assignment("EXCON", "EX-B", { status: "REVOKED" }),
      assignment("EXCON", "EX-C", { expiresAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(resolveAvailableUserModes(state, "2026-10-01T00:00:00.000Z")).toEqual([{ mode: "CM", exerciseIds: ["EX-A"] }]);
  });

  test("MODE-NAV-01 selects the only available mode directly", () => {
    expect(reconcileOperatorMode(authenticated([assignment("CM", "EX-A")])).selectedMode).toBe("CM");
  });

  test("MODE-NAV-05 restores the last selected mode only when still authorized", () => {
    const state = authenticated([assignment("CM", "EX-A"), assignment("EXCON", "EX-A")], true);
    selectOperatorMode(state, "EXCON");
    resetOperatorModeForTests();
    expect(reconcileOperatorMode(state).selectedMode).toBe("EXCON");
  });

  test("MODE-NAV-06 ignores and removes a remembered revoked mode", () => {
    storage.set("russicaptor.ui.last-selected-mode.USER-1", "EXCON");
    const result = reconcileOperatorMode(authenticated([assignment("CM", "EX-A")], true));
    expect(result.selectedMode).toBeUndefined();
    expect(storage.has("russicaptor.ui.last-selected-mode.USER-1")).toBe(false);
  });

  test("MODE-WRITER-01/02/03 reuses runtime exit without signing out Auth", async () => {
    const state = authenticated([assignment("CM", "EX-A"), assignment("EXCON", "EX-A")], true);
    selectOperatorMode(state, "EXCON");
    await expect(switchOperatorMode(state, "CM")).resolves.toMatchObject({ selectedMode: "CM" });
    expect(mockPrepareRuntimeExit).toHaveBeenCalledTimes(1);
    expect(mockCompleteRuntimeExit).toHaveBeenCalledTimes(1);
  });

  test("MODE-WRITER-04 release failure blocks the mode change and preserves a retry", async () => {
    const state = authenticated([assignment("CM", "EX-A"), assignment("EXCON", "EX-A")]);
    selectOperatorMode(state, "EXCON");
    mockPrepareRuntimeExit.mockRejectedValueOnce(new Error("offline"));
    await expect(switchOperatorMode(state, "CM")).rejects.toThrow("offline");
    expect(getOperatorModeSnapshot().selectedMode).toBe("EXCON");
    expect(mockCompleteRuntimeExit).not.toHaveBeenCalled();
  });
});
