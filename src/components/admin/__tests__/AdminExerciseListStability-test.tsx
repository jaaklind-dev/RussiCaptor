import React from "react";
import { Alert, Text, TextInput } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import AdminExercisesScreen from "@/app/admin/exercises";
import { filterAdminExercises, isFinishedAdminExercise } from "@/services/admin/AdminExerciseListSelectors";

const mockListExercises = jest.fn();
const mockListUsers = jest.fn();
const mockRefreshSession = jest.fn();
const mockCancelReady = jest.fn();
let mockAuthGeneration = 1;
let mockSession: { state: string; isPlatformAdmin?: boolean; profile?: { userId: string } } =
  { state: "AUTHENTICATED", isPlatformAdmin: true, profile: { userId: "USER-1" } };

jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockSession }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({
  refreshOperatorSession: () => mockRefreshSession(),
  getOperatorAuthSessionGeneration: () => mockAuthGeneration,
}));
jest.mock("@/services/admin/PlatformAdminService", () => ({
  listAdminExerciseOverview: (...args: unknown[]) => mockListExercises(...args),
  listAdminUsers: (...args: unknown[]) => mockListUsers(...args),
  cancelReadyExercise: (...args: unknown[]) => mockCancelReady(...args),
  grantExerciseRole: jest.fn(), revokeExerciseRole: jest.fn(),
}));

const target = Object.freeze({ exerciseId: "EX-1789553119340-1", revision: 1,
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.5", lifecycleState: "READY",
  updatedAt: "2026-10-08T00:00:00Z", participantCount: 0, cmCount: 0, exconCount: 0, assignments: [] });
const overview = (enabled: boolean) => ({ exercises: [target], readyCancellationEnabled: enabled });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const visibleText = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text)
  .flatMap(node => Array.isArray(node.props.children) ? node.props.children : [node.props.children])
  .filter(value => typeof value === "string").join(" ");
const mount = async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AdminExercisesScreen />); });
  return renderer;
};
const selectTarget = async (screen: TestRenderer.ReactTestRenderer) => {
  await act(async () => { screen.root.findByProps({ testID: `admin-exercise-${target.exerciseId}` }).props.onPress(); });
};

describe("Admin Exercises list stability", () => {
  beforeEach(() => {
    mockListExercises.mockReset().mockResolvedValue(overview(false));
    mockListUsers.mockReset().mockResolvedValue([]);
    mockRefreshSession.mockReset().mockResolvedValue(undefined);
    mockCancelReady.mockReset();
    mockAuthGeneration = 1;
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: true, profile: { userId: "USER-1" } };
  });

  test("ADMIN-LIST-01 auth pending makes no backend request", async () => {
    mockSession = { state: "LOADING" };
    const screen = await mount();
    expect(mockListExercises).not.toHaveBeenCalled();
    expect(visibleText(screen)).toContain("Laadin kasutajaõigusi");
  });

  test("ADMIN-LIST-02 admin authority pending makes no backend request", async () => {
    mockSession = { state: "UNAVAILABLE" };
    const screen = await mount();
    expect(mockListExercises).not.toHaveBeenCalled();
    expect(visibleText(screen)).toContain("Administraatori õigused pole saadaval");
  });

  test("ADMIN-LIST-03/04 stale response after auth transition cannot poison current result", async () => {
    const old = deferred<ReturnType<typeof overview>>();
    mockListExercises.mockReset().mockReturnValueOnce(old.promise).mockResolvedValue(overview(false));
    const screen = await mount();
    mockSession = { state: "LOADING" };
    await act(async () => { screen.update(<AdminExercisesScreen />); });
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: true, profile: { userId: "USER-1" } };
    await act(async () => { screen.update(<AdminExercisesScreen />); });
    old.reject(new Error("old request failed"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(screen.root.findAllByProps({ testID: "admin-exercises-error" })).toHaveLength(0);
  });

  test("ADMIN-LIST-05 cached list remains visible after refresh failure", async () => {
    const screen = await mount();
    mockListExercises.mockRejectedValueOnce(new Error("backend details"));
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(visibleText(screen)).toContain("Varasem nimekiri on endiselt nähtav");
    expect(visibleText(screen)).not.toContain("backend details");
  });

  test("ADMIN-LIST-06 first load failure shows bounded error", async () => {
    mockListExercises.mockRejectedValueOnce(new Error("private backend detail"));
    const screen = await mount();
    expect(visibleText(screen)).toContain("Õppuste laadimine ebaõnnestus");
    expect(visibleText(screen)).not.toContain("private backend detail");
  });

  test("ADMIN-LIST-07 retry after first-load failure works", async () => {
    mockListExercises.mockRejectedValueOnce(new Error("unavailable"));
    const screen = await mount();
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(screen.root.findAllByProps({ testID: "admin-exercises-error" })).toHaveLength(0);
  });

  test("ADMIN-LIST-08 target READY exercise renders from authoritative response", async () => {
    const screen = await mount();
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(visibleText(screen)).toContain("Valmis");
  });

  test("ADMIN-LIST-10 remount loads once without any mutation", async () => {
    const first = await mount();
    await act(async () => first.unmount());
    const second = await mount();
    expect(mockListExercises).toHaveBeenCalledTimes(2);
    expect(second.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
  });

  test("ADMIN-LIST-11 user enrichment failure does not erase exercise list", async () => {
    mockListUsers.mockRejectedValueOnce(new Error("users unavailable"));
    const screen = await mount();
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(visibleText(screen)).toContain("Kasutajate laadimine ebaõnnestus");
  });

  test("ADMIN-LIST-12 ordinary user cannot invoke admin list", async () => {
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: false };
    const screen = await mount();
    expect(mockListExercises).not.toHaveBeenCalled();
    expect(visibleText(screen)).toContain("Administraatori õigused pole saadaval");
  });

  test("READY cancellation stays hidden until the authoritative list explicitly enables it", async () => {
    const screen = await mount();
    await selectTarget(screen);
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" })).toHaveLength(0);
    expect(visibleText(screen)).toContain("tühistamine ei ole praegu saadaval");
    mockListExercises.mockResolvedValueOnce(overview(true));
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" }).length).toBeGreaterThan(0);
  });

  test("a refresh failure hides cancellation even while the cached READY exercise stays visible", async () => {
    mockListExercises.mockResolvedValueOnce(overview(true));
    const screen = await mount();
    await selectTarget(screen);
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" }).length).toBeGreaterThan(0);
    mockListExercises.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" })).toHaveLength(0);
  });

  test("an auth transition clears previously enabled cancellation and rejects stale list responses", async () => {
    mockListExercises.mockResolvedValueOnce(overview(true));
    const screen = await mount();
    await selectTarget(screen);
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" }).length).toBeGreaterThan(0);
    const stale = deferred<ReturnType<typeof overview>>();
    mockListExercises.mockReturnValueOnce(stale.promise).mockResolvedValue(overview(false));
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    mockSession = { state: "UNAVAILABLE" };
    mockAuthGeneration += 1;
    await act(async () => { screen.update(<AdminExercisesScreen />); });
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: true, profile: { userId: "USER-1" } };
    mockAuthGeneration += 1;
    await act(async () => { screen.update(<AdminExercisesScreen />); });
    stale.resolve(overview(true));
    await act(async () => { await Promise.resolve(); });
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" })).toHaveLength(0);
  });

  test("a server-side disabled response clears the Admin control without reporting success", async () => {
    mockListExercises.mockResolvedValueOnce(overview(true));
    mockCancelReady.mockRejectedValueOnce(new Error("READY_CANCELLATION_DISABLED"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    try {
      const screen = await mount();
      await selectTarget(screen);
      const button = screen.root.findAllByProps({ testID: "admin-cancel-ready" })
        .find(node => typeof node.props.onPress === "function");
      await act(async () => { button?.props.onPress(); });
      const actions = alert.mock.calls.at(-1)?.[2];
      await act(async () => { actions?.[1]?.onPress?.(); await Promise.resolve(); });
      expect(mockCancelReady).toHaveBeenCalledTimes(1);
      expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" })).toHaveLength(0);
      expect(visibleText(screen)).toContain("Õppuse tühistamine ei ole praegu sisse lülitatud");
      expect(visibleText(screen)).not.toContain("Õppus tühistatud. Rollide tühistamine");
    } finally {
      alert.mockRestore();
    }
  });

  test.each(["COMPLETED", "CANCELLED", "TERMINATED"])("finished %s stays preserved and is only shown on explicit selection", async lifecycleState => {
    const finished = Object.freeze({ ...target, exerciseId: `EX-${lifecycleState}`, lifecycleState });
    const source = Object.freeze([finished, target]);
    mockListExercises.mockResolvedValue({ ...overview(true), exercises: source });
    const screen = await mount();
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${finished.exerciseId}` })).toHaveLength(0);
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    await selectTarget(screen);
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-finished" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` })).toHaveLength(0);
    expect(screen.root.findAllByProps({ testID: "admin-cancel-ready" })).toHaveLength(0);
    await act(async () => { screen.root.findByProps({ testID: `admin-exercise-${finished.exerciseId}` }).props.onPress(); });
    expect(visibleText(screen)).toContain("Terminalne õppus on kirjutuskaitstud");
    expect(screen.root.findByProps({ testID: "admin-exercise-grant-cm" }).props.disabled).toBe(true);
    expect(screen.root.findByProps({ testID: "admin-exercise-grant-excon" }).props.disabled).toBe(true);
    expect(mockListExercises).toHaveBeenCalledTimes(1);
    expect(mockCancelReady).not.toHaveBeenCalled();
    expect(source).toEqual([finished, target]);
  });

  test.each(["READY", "RUNNING", "PAUSED", "UNKNOWN", "UNRECOGNIZED_STATE"])("nonterminal or unknown %s remains visible by default", async lifecycleState => {
    mockListExercises.mockResolvedValue({ ...overview(false), exercises: [{ ...target, lifecycleState }] });
    const screen = await mount();
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(screen.root.findByProps({ testID: "admin-exercises-current" }).props.accessibilityState.selected).toBe(true);
  });

  test("view switching clears role selection and does not perform backend operations", async () => {
    mockListUsers.mockResolvedValue([{ userId: "USER-2", displayName: "Test User", email: "test@example.invalid", status: "ACTIVE", assignments: [] }]);
    const screen = await mount();
    await selectTarget(screen);
    await act(async () => { screen.root.findByType(TextInput).props.onChangeText("Test"); });
    await act(async () => { screen.root.findByProps({ testID: "admin-exercise-user-USER-2" }).props.onPress(); });
    expect(screen.root.findByProps({ testID: "admin-exercise-grant-cm" }).props.disabled).toBe(false);
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-finished" }).props.onPress(); });
    expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-current" }).props.onPress(); });
    expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
    await selectTarget(screen);
    expect(screen.root.findByType(TextInput).props.value).toBe("");
    expect(screen.root.findByProps({ testID: "admin-exercise-grant-cm" }).props.disabled).toBe(true);
    expect(screen.root.findByProps({ testID: "admin-exercise-grant-excon" }).props.disabled).toBe(true);
    expect(mockListExercises).toHaveBeenCalledTimes(1);
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(mockCancelReady).not.toHaveBeenCalled();
  });

  test("refresh moves a completed item out of the current view without deleting it", async () => {
    const screen = await mount();
    await selectTarget(screen);
    mockListExercises.mockResolvedValueOnce({ ...overview(false), exercises: [{ ...target, lifecycleState: "COMPLETED" }] });
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` })).toHaveLength(0);
    expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
    expect(visibleText(screen)).toContain("Saadud nimekirjas pole pooleli õppusi");
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-finished" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
  });

  test("finished view retains cached records on read failure and remount defaults to current", async () => {
    mockListExercises.mockResolvedValue({ ...overview(false), exercises: [{ ...target, lifecycleState: "COMPLETED" }] });
    const screen = await mount();
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-finished" }).props.onPress(); });
    mockListExercises.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => { screen.root.findByProps({ testID: "admin-exercises-retry" }).props.onPress(); });
    expect(screen.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` }).length).toBeGreaterThan(0);
    expect(visibleText(screen)).toContain("Varasem nimekiri on endiselt nähtav");
    await act(async () => screen.unmount());
    const remounted = await mount();
    expect(remounted.root.findByProps({ testID: "admin-exercises-current" }).props.accessibilityState.selected).toBe(true);
    expect(remounted.root.findAllByProps({ testID: `admin-exercise-${target.exerciseId}` })).toHaveLength(0);
  });

  test("selector preserves object identity/order, is non-destructive and keeps unknown lifecycles visible", () => {
    const completed = Object.freeze({ ...target, exerciseId: "EX-DONE", lifecycleState: "COMPLETED" });
    const unknown = Object.freeze({ ...target, exerciseId: "EX-UNKNOWN", lifecycleState: "FUTURE_STATE" });
    const source = Object.freeze([completed, target, unknown]);
    expect(filterAdminExercises(source, "CURRENT")).toEqual([target, unknown]);
    expect(filterAdminExercises(source, "FINISHED")).toEqual([completed]);
    expect(filterAdminExercises(source, "CURRENT")[0]).toBe(target);
    expect(source).toEqual([completed, target, unknown]);
    expect(isFinishedAdminExercise(unknown)).toBe(false);
  });
});
