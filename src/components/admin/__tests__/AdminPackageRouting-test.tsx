import React from "react";
import fs from "node:fs";
import path from "node:path";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import {
  adminPackageCreateRoute,
  adminPackageRouteParams,
  resolveAdminPackageSelection,
} from "@/services/admin/AdminPackageSelectionService";
import AdminExerciseCreateScreen from "../AdminExerciseCreateScreen";
import AdminPackageSelectionScreen from "../AdminPackageSelectionScreen";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCreate = jest.fn();

jest.mock("expo-router", () => ({ router: {
  back: (...args: unknown[]) => mockBack(...args),
  push: (...args: unknown[]) => mockPush(...args),
  replace: (...args: unknown[]) => mockReplace(...args),
} }));
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => ({
  state: "AUTHENTICATED", profile: { userId: "USER-ADMIN", displayName: "Admin" },
}) }));
jest.mock("@/services/admin/PlatformAdminExerciseCreation", () => ({
  createAdminExercise: (...args: unknown[]) => mockCreate(...args),
}));

const registry = {
  get: (packageId: string, packageVersion: string) => [AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE]
    .find(pkg => pkg.packageId === packageId && pkg.packageVersion === packageVersion),
};

const visibleText = (renderer: TestRenderer.ReactTestRenderer): string => renderer.root
  .findAllByType(Text)
  .flatMap(node => Array.isArray(node.props.children) ? node.props.children : [node.props.children])
  .filter(value => typeof value === "string")
  .join(" ");

describe("Admin package-selection routing", () => {
  beforeEach(() => { mockBack.mockReset(); mockPush.mockReset(); mockReplace.mockReset(); mockCreate.mockReset(); });

  test("ADMIN-PKG-01 package selection routes to the Admin creation screen", () => {
    const exercisesRoute = fs.readFileSync(path.join(process.cwd(), "src/app/admin/exercises.tsx"), "utf8");
    expect(exercisesRoute).toContain('router.push("/admin/package-selection")');
    expect(exercisesRoute).not.toContain('/excon/catalog');
    expect(adminPackageCreateRoute(adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE))).toEqual({
      pathname: "/admin/exercise-create",
      params: { packageId: AIRWAY_EXERCISE_PACKAGE.packageId, packageVersion: AIRWAY_EXERCISE_PACKAGE.packageVersion },
    });
  });

  test("ADMIN-PKG-02 preserves exact package ID and version", () => {
    const result = resolveAdminPackageSelection(adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE), registry);
    expect(result).toMatchObject({ ok: true, identity: adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE) });
  });

  test("ADMIN-PKG-03 package A cannot become package B through stale state", () => {
    const first = resolveAdminPackageSelection(adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE), registry);
    const second = resolveAdminPackageSelection(adminPackageRouteParams(PELVIC_INJURY_EXERCISE_PACKAGE), registry);
    expect(first.ok && first.package.packageId).toBe(AIRWAY_EXERCISE_PACKAGE.packageId);
    expect(second.ok && second.package.packageId).toBe(PELVIC_INJURY_EXERCISE_PACKAGE.packageId);
  });

  test("ADMIN-PKG-04 cancel clears the transient flow by returning to Exercises", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminPackageSelectionScreen />); });
    await act(async () => renderer.root.findByProps({ testID: "admin-package-cancel" }).props.onPress());
    expect(mockReplace).toHaveBeenCalledWith("/admin/exercises");
  });

  test("ADMIN-PKG-05 back navigation exits selection without activating a package", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminPackageSelectionScreen />); });
    await act(async () => renderer.root.findByProps({ testID: "admin-package-back" }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("ADMIN-PKG-06 a second creation starts from a selection screen without hidden package state", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminPackageSelectionScreen />); });
    expect(renderer.root.findAllByProps({ testID: "admin-selected-package" })).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("ADMIN-PKG-07 malformed route parameters fail closed", () => {
    expect(resolveAdminPackageSelection({ packageId: ["duplicate"], packageVersion: "1.0.0" }, registry))
      .toMatchObject({ ok: false, code: "INVALID_ROUTE" });
  });

  test("ADMIN-PKG-08 removed or unavailable package cannot be used", () => {
    expect(resolveAdminPackageSelection({ packageId: "removed.package", packageVersion: "9.9.9" }, registry))
      .toMatchObject({ ok: false, code: "PACKAGE_UNAVAILABLE" });
  });

  test("ADMIN-PKG-09 multiple package identities route independently", () => {
    const routes = [AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE]
      .map(pkg => adminPackageCreateRoute(adminPackageRouteParams(pkg)));
    expect(routes[0].params).not.toEqual(routes[1].params);
    expect(routes.map(route => route.params.packageId)).toEqual([
      AIRWAY_EXERCISE_PACKAGE.packageId,
      PELVIC_INJURY_EXERCISE_PACKAGE.packageId,
    ]);
  });

  test("ADMIN-PKG-10 creation hands off exactly the route-selected package", async () => {
    mockCreate.mockResolvedValue("EX-ADMIN-ROUTE-1");
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminExerciseCreateScreen routeInput={adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE)} />); });
    await act(async () => renderer.root.findByProps({ testID: "admin-create-selected-package" }).props.onPress());
    expect(mockCreate).toHaveBeenCalledWith("USER-ADMIN", adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE));
  });

  test("ADMIN-PKG-11 normal Admin UI does not render raw package identity or hash", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminExerciseCreateScreen routeInput={adminPackageRouteParams(AIRWAY_EXERCISE_PACKAGE)} />); });
    const text = visibleText(renderer);
    expect(text).not.toContain(AIRWAY_EXERCISE_PACKAGE.packageId);
    expect(text).not.toContain(AIRWAY_EXERCISE_PACKAGE.packageHash);
    expect(text).toContain(AIRWAY_EXERCISE_PACKAGE.packageVersion);
  });

  test("ADMIN-PKG-12 successful creation returns to existing Exercises detail selection", async () => {
    mockCreate.mockResolvedValue("EX-ADMIN-ROUTE-2");
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AdminExerciseCreateScreen routeInput={adminPackageRouteParams(PELVIC_INJURY_EXERCISE_PACKAGE)} />); });
    await act(async () => renderer.root.findByProps({ testID: "admin-create-selected-package" }).props.onPress());
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/admin/exercises", params: { createdExerciseId: "EX-ADMIN-ROUTE-2" } });
  });
});
