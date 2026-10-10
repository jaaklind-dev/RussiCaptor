import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import RoleModeSwitcher from "../RoleModeSwitcher";

const mockReplace = jest.fn();
const mockSwitchMode = jest.fn();
const mockRefreshExercise = jest.fn(async () => undefined);
let mockOperator: OperatorSessionState;
let mockSelectedMode: "ADMIN" | "CM" | "EXCON" | undefined;

jest.mock("expo-router", () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockOperator }));
jest.mock("@/hooks/useOperatorMode", () => ({ useOperatorMode: () => ({ userId: "USER-1", selectedMode: mockSelectedMode }) }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: () => ({ exerciseId: "EX-A" }) }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({
  refreshOperatorSession: jest.fn(),
  activeScopedExerciseIds: (state: OperatorSessionState, role: string) => state.state === "AUTHENTICATED"
    ? state.principal.roleAssignments.filter(item => item.status === "ACTIVE" && item.role === role && item.scope.scopeType === "EXERCISE")
      .map(item => item.scope.scopeType === "EXERCISE" ? item.scope.scopeId : "") : [],
  hasPlatformAdminAuthority: (state: OperatorSessionState) => state.state === "AUTHENTICATED" && state.isPlatformAdmin === true,
}));
jest.mock("@/services/CloudSyncService", () => ({ refreshRemoteCurrentExercise: () => mockRefreshExercise() }));
jest.mock("@/services/ui/OperatorModeService", () => {
  const actual = jest.requireActual("@/services/ui/OperatorModeService");
  return { ...actual, switchOperatorMode: (...args: unknown[]) => mockSwitchMode(...args) };
});
jest.mock("@/services/ui/OperatorRouteService", () => ({
  resolveSelectedModeRoute: (_operator: unknown, mode: string) => mode === "ADMIN" ? "/admin" : mode === "CM" ? "/dashboard" : "/excon",
}));

function state(): OperatorSessionState {
  return { state: "AUTHENTICATED", isPlatformAdmin: true, profile: { userId: "USER-1", displayName: "Test" },
    principal: { userId: "USER-1", authenticationState: "AUTHENTICATED", roleAssignments: [
      { assignmentId: "CM", userId: "USER-1", role: "CM", scope: { scopeType: "EXERCISE", scopeId: "EX-A" }, status: "ACTIVE", issuedAt: "2026-10-01", issuedBy: "ADMIN" },
      { assignmentId: "EXCON", userId: "USER-1", role: "EXCON", scope: { scopeType: "EXERCISE", scopeId: "EX-A" }, status: "ACTIVE", issuedAt: "2026-10-01", issuedBy: "ADMIN" },
    ], permissions: [], authorizationFreshness: "VERIFIED_ONLINE",
    authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-10-01", expiresAt: "2026-10-02" } } };
}

describe("role mode switcher production UI", () => {
  beforeEach(() => { mockOperator = state(); mockSelectedMode = "ADMIN"; mockReplace.mockReset(); mockSwitchMode.mockReset(); mockRefreshExercise.mockClear(); mockSwitchMode.mockResolvedValue({ selectedMode: "CM" }); });

  async function render() {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<RoleModeSwitcher />); });
    return renderer;
  }
  const buttons = (renderer: TestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(
    node => node.props.testID === testID && typeof node.props.onPress === "function",
  );

  test("MODE-UI-01/02 renders only authorized modes and marks the selection", async () => {
    const renderer = await render();
    expect(buttons(renderer, "mode-admin")).toHaveLength(1);
    expect(buttons(renderer, "mode-cm")).toHaveLength(1);
    expect(buttons(renderer, "mode-excon")).toHaveLength(1);
    expect(buttons(renderer, "mode-admin")[0].props.accessibilityState.selected).toBe(true);
  });

  test("MODE-UI-01 hides unavailable modes", async () => {
    const authenticated = state();
    if (authenticated.state !== "AUTHENTICATED") throw new Error("setup");
    mockOperator = { ...authenticated, isPlatformAdmin: false,
      principal: { ...authenticated.principal, roleAssignments: authenticated.principal.roleAssignments.slice(0, 1) } };
    mockSelectedMode = "CM";
    const renderer = await render();
    expect(buttons(renderer, "mode-admin")).toHaveLength(0);
    expect(buttons(renderer, "mode-cm")).toHaveLength(1);
    expect(buttons(renderer, "mode-excon")).toHaveLength(0);
  });

  test("MODE-NAV-02/03/04 uses deterministic semantic controls", async () => {
    const renderer = await render();
    await act(async () => buttons(renderer, "mode-cm")[0].props.onPress());
    expect(mockSwitchMode).toHaveBeenCalledWith(mockOperator, "CM");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  test("EXCON-SEL-05 mode switch refreshes scoped exercise before entering EXCON", async () => {
    const renderer = await render();
    await act(async () => buttons(renderer, "mode-excon")[0].props.onPress());
    expect(mockRefreshExercise).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/excon");
    expect(mockRefreshExercise.mock.invocationCallOrder[0]).toBeLessThan(mockReplace.mock.invocationCallOrder[0]);
  });

  test("MODE-WRITER-04 renders only the bounded fail-closed error", async () => {
    mockSwitchMode.mockRejectedValue(new Error("secret backend payload"));
    const renderer = await render();
    await act(async () => buttons(renderer, "mode-cm")[0].props.onPress());
    expect(renderer.root.findByProps({ accessibilityRole: "alert" }).props.children)
      .toBe("Režiimi vahetamine ei õnnestunud. Proovi uuesti.");
  });
});
