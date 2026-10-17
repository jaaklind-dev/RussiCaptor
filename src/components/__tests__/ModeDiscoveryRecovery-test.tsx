import TestRenderer, { act } from "react-test-renderer";
import ModeSelectionScreen from "@/app/mode";
import type { ExconRouteReadiness } from "@/services/ui/ExconRouteReadinessService";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
let mockReadiness: ExconRouteReadiness;
const mockOperator = { state: "AUTHENTICATED", profile: { userId: "U" }, principal: { roleAssignments: [] } };
jest.mock("expo-router", () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) }, useLocalSearchParams: () => ({}) }));
jest.mock("@/components/RoleModeSwitcher", () => () => null);
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockOperator }));
jest.mock("@/hooks/useOperatorMode", () => ({ useOperatorMode: () => ({ userId: "U", selectedMode: "EXCON" }) }));
jest.mock("@/hooks/useExconRouteReadiness", () => ({ useExconRouteReadiness: () => mockReadiness }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({ refreshOperatorSession: jest.fn(), hasActiveRole: () => true }));
jest.mock("@/services/ui/OperatorModeService", () => ({ resolveAvailableUserModes: () => [{ mode: "EXCON", exerciseIds: ["E"] }] }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: () => ({ exerciseId: "E" }) }));
jest.mock("@/services/SyncService", () => ({ subscribeToSync: () => () => {}, getSyncVersion: () => 0 }));
jest.mock("@/services/CloudSyncService", () => ({ refreshRemoteCurrentExercise: (...args: unknown[]) => mockRefresh(...args) }));
jest.mock("@/services/exercise/ActiveExerciseConflictResolutionService", () => ({ refreshActiveExerciseConflict: jest.fn(), continueAssignedActiveExercise: jest.fn() }));

describe("mounted mode-screen discovery recovery", () => {
  beforeEach(() => { mockReplace.mockClear(); mockRefresh.mockReset(); mockReadiness = { state: "DENIED", reason: "EXERCISE_UNAVAILABLE" }; });
  test("unavailable repeated renders and remounts are stable and perform no automatic retry", async () => {
    for (let mount = 0; mount < 4; mount++) {
      let screen!: TestRenderer.ReactTestRenderer;
      await act(async () => { screen = TestRenderer.create(<ModeSelectionScreen />); });
      for (let i = 0; i < 5; i++) await act(async () => { screen.update(<ModeSelectionScreen />); });
      expect(JSON.stringify(screen.toJSON())).toContain("Kontrolli õppust uuesti");
      await act(async () => screen.unmount());
    }
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
  test("one explicit retry, disabled while pending, then resolved discovery navigates normally", async () => {
    let finish!: () => void;
    mockRefresh.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<ModeSelectionScreen />); });
    const button = () => screen.root.findAll(node => node.props.testID === "retry-exercise-discovery" && typeof node.props.onPress === "function")[0];
    await act(async () => { button().props.onPress(); });
    expect(button().props.disabled).toBe(true);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith("manual");
    await act(async () => { finish(); });
    expect(mockReplace).not.toHaveBeenCalled();
    mockReadiness = { state: "AUTHORIZED", exerciseId: "E", intendedExerciseId: "E" };
    await act(async () => { screen.update(<ModeSelectionScreen />); });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/excon");
    await act(async () => screen.unmount());
  });
  test("failed retry stays recoverable without automatic resubmission", async () => {
    mockRefresh.mockRejectedValue(new Error("NETWORK"));
    let screen!: TestRenderer.ReactTestRenderer;
    await act(async () => { screen = TestRenderer.create(<ModeSelectionScreen />); });
    await act(async () => { screen.root.findAll(node => node.props.testID === "retry-exercise-discovery" && typeof node.props.onPress === "function")[0].props.onPress(); });
    expect(JSON.stringify(screen.toJSON())).toContain("Õppuse andmete kontroll ei õnnestunud");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });
});
