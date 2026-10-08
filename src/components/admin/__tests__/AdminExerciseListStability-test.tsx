import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import AdminExercisesScreen from "@/app/admin/exercises";

const mockListExercises = jest.fn();
const mockListUsers = jest.fn();
const mockRefreshSession = jest.fn();
let mockSession: { state: string; isPlatformAdmin?: boolean } = { state: "AUTHENTICATED", isPlatformAdmin: true };

jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockSession }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({ refreshOperatorSession: () => mockRefreshSession() }));
jest.mock("@/services/admin/PlatformAdminService", () => ({
  listAdminExercises: (...args: unknown[]) => mockListExercises(...args),
  listAdminUsers: (...args: unknown[]) => mockListUsers(...args),
  grantExerciseRole: jest.fn(), revokeExerciseRole: jest.fn(),
}));

const target = Object.freeze({ exerciseId: "EX-1789553119340-1", revision: 1,
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.5", lifecycleState: "READY",
  updatedAt: "2026-10-08T00:00:00Z", participantCount: 0, cmCount: 0, exconCount: 0, assignments: [] });
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

describe("Admin Exercises list stability", () => {
  beforeEach(() => {
    mockListExercises.mockReset().mockResolvedValue([target]);
    mockListUsers.mockReset().mockResolvedValue([]);
    mockRefreshSession.mockReset().mockResolvedValue(undefined);
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: true };
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
    const old = deferred<typeof target[]>();
    mockListExercises.mockReset().mockReturnValueOnce(old.promise).mockResolvedValue([target]);
    const screen = await mount();
    mockSession = { state: "LOADING" };
    await act(async () => { screen.update(<AdminExercisesScreen />); });
    mockSession = { state: "AUTHENTICATED", isPlatformAdmin: true };
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
});
