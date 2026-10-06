import { createAdminExercise, type AdminExerciseCreationDependencies } from "../PlatformAdminExerciseCreation";
import { AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";

const identity = Object.freeze({
  packageId: AIRWAY_EXERCISE_PACKAGE.packageId,
  packageVersion: AIRWAY_EXERCISE_PACKAGE.packageVersion,
});

describe("platform-admin exercise creation", () => {
  test("uses bootstrap authority and the existing canonical preparation path", async () => {
    const calls: string[] = [];
    const dependencies: AdminExerciseCreationDependencies = {
      resolvePackage: () => AIRWAY_EXERCISE_PACKAGE,
      grantBootstrap: async userId => { calls.push(`bootstrap:${userId}`); },
      refreshSession: async () => { calls.push("refresh"); },
      prepare: selected => { calls.push(`prepare:${selected.packageId}@${selected.packageVersion}`); return { ok: true, exerciseId: "EX-ADMIN-1", exercisePackage: AIRWAY_EXERCISE_PACKAGE }; },
    };

    await expect(createAdminExercise("USER-ADMIN", identity, dependencies)).resolves.toBe("EX-ADMIN-1");
    expect(calls).toEqual(["bootstrap:USER-ADMIN", "refresh", `prepare:${identity.packageId}@${identity.packageVersion}`]);
  });

  test("surfaces the canonical preparation refusal without manufacturing an exercise", async () => {
    const dependencies: AdminExerciseCreationDependencies = {
      resolvePackage: () => AIRWAY_EXERCISE_PACKAGE,
      grantBootstrap: async () => undefined,
      refreshSession: async () => undefined,
      prepare: () => ({ ok: false, code: "ACTIVE_EXERCISE", message: "Aktiivne õppus tuleb enne lõpetada." }),
    };

    await expect(createAdminExercise("USER-ADMIN", identity, dependencies)).rejects.toThrow("Aktiivne õppus tuleb enne lõpetada.");
  });

  test("ADMIN-PKG-08 rejects an unavailable package before granting bootstrap authority", async () => {
    const grantBootstrap = jest.fn();
    const dependencies: AdminExerciseCreationDependencies = {
      resolvePackage: () => undefined,
      grantBootstrap,
      refreshSession: async () => undefined,
      prepare: () => ({ ok: false, message: "must not run" }),
    };
    await expect(createAdminExercise("USER-ADMIN", identity, dependencies)).rejects.toThrow("pole enam saadaval");
    expect(grantBootstrap).not.toHaveBeenCalled();
  });

  test("ADMIN-PKG-10 rejects a canonical result bound to a different package", async () => {
    const dependencies: AdminExerciseCreationDependencies = {
      resolvePackage: () => AIRWAY_EXERCISE_PACKAGE,
      grantBootstrap: async () => undefined,
      refreshSession: async () => undefined,
      prepare: () => ({ ok: true, exerciseId: "EX-WRONG", exercisePackage: PELVIC_INJURY_EXERCISE_PACKAGE }),
    };
    await expect(createAdminExercise("USER-ADMIN", identity, dependencies)).rejects.toThrow("paketisidumine ei vasta");
  });
});
