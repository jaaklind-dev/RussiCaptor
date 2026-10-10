import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import LoginScreen from "@/app/index";

const mockReplace = jest.fn();
let mockOperator: { state: string; message?: string } = { state: "UNAUTHENTICATED" };
jest.mock("expo-router", () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({}) }));
jest.mock("@/components/AppHeader", () => () => null);
jest.mock("@/config/ReleaseConfig", () => ({ getBuildProvenance: () => ({ versionCode: 159 }),
  getReleaseConfigurationError: () => undefined }));
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockOperator }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({ signInOperator: jest.fn() }));
jest.mock("@/services/ui/OperatorModeService", () => ({ reconcileOperatorMode: () => ({ selectedMode: undefined }) }));
jest.mock("@/services/ui/OperatorRouteService", () => ({ resolveSelectedModeNavigationTarget:
  (operator: { state: string }) => operator.state === "AUTHENTICATED" ? "/mode" : undefined }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: () => ({ exerciseId: "EX-1" }) }));
jest.mock("@/services/SyncService", () => ({ subscribeToSync: () => () => {}, getSyncVersion: () => 0 }));

const text = (screen: TestRenderer.ReactTestRenderer) => screen.root.findAllByType(Text)
  .flatMap(node => Array.isArray(node.props.children) ? node.props.children : [node.props.children])
  .filter(value => typeof value === "string").join(" ");

describe("login screen after role hydration", () => {
  beforeEach(() => { mockReplace.mockReset(); mockOperator = { state: "UNAUTHENTICATED" }; });

  test("AUTH-HYDRATE-06: current authorization exits the login route", async () => {
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<LoginScreen />); });
    expect(mockReplace).not.toHaveBeenCalled();
    mockOperator = { state: "AUTHENTICATED" };
    await act(async () => { screen.update(<LoginScreen />); });
    expect(mockReplace).toHaveBeenCalledWith("/mode");
  });

  test("AUTH-HYDRATE-05/07: later authority denial is visible, not silent or a password error", async () => {
    mockOperator = { state: "UNAUTHORIZED", message: "Operaatori õigusi ei saanud kinnitada." };
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<LoginScreen />); });
    expect(text(screen)).toContain("Operaatori õigusi ei saanud kinnitada.");
    expect(text(screen)).not.toContain("parooli");
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
