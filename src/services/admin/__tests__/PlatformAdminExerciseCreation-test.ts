import { createAdminExercise, type AdminExerciseCreationDependencies } from "../PlatformAdminExerciseCreation";

describe("platform-admin exercise creation", () => {
  test("uses bootstrap authority and the existing canonical preparation path", async () => {
    const calls: string[] = [];
    const dependencies: AdminExerciseCreationDependencies = {
      grantBootstrap: async userId => { calls.push(`bootstrap:${userId}`); },
      refreshSession: async () => { calls.push("refresh"); },
      prepare: () => { calls.push("prepare"); return { ok: true, exerciseId: "EX-ADMIN-1" }; },
    };

    await expect(createAdminExercise("USER-ADMIN", dependencies)).resolves.toBe("EX-ADMIN-1");
    expect(calls).toEqual(["bootstrap:USER-ADMIN", "refresh", "prepare"]);
  });

  test("surfaces the canonical preparation refusal without manufacturing an exercise", async () => {
    const dependencies: AdminExerciseCreationDependencies = {
      grantBootstrap: async () => undefined,
      refreshSession: async () => undefined,
      prepare: () => ({ ok: false, code: "ACTIVE_EXERCISE", message: "Aktiivne õppus tuleb enne lõpetada." }),
    };

    await expect(createAdminExercise("USER-ADMIN", dependencies)).rejects.toThrow("Aktiivne õppus tuleb enne lõpetada.");
  });
});
