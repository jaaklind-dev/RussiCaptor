import fs from "node:fs";
import path from "node:path";

import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import {
  beginInitialExercisePublication,
  finishInitialExercisePublication,
  resetInitialExercisePublicationFenceForTests,
  shouldPreservePendingInitialExercise,
} from "@/services/exercise/InitialExercisePublicationFence";
import {
  bootstrapConsumptionMatches,
  initialExerciseReadbackMatches,
} from "@/services/CloudSyncService";
import {
  createAdminExercise,
  getAdminExerciseCreationPhase,
  resetAdminExerciseCreationAttemptsForTests,
  type AdminExerciseCreationDependencies,
} from "../PlatformAdminExerciseCreation";

const identity = Object.freeze({
  packageId: AIRWAY_EXERCISE_PACKAGE.packageId,
  packageVersion: AIRWAY_EXERCISE_PACKAGE.packageVersion,
});
const beforeState = { exerciseSession: { exerciseId: "EX-OLD" } } as unknown as SharedExerciseState;
const provisionalState = { exerciseSession: { exerciseId: "EX-ACK-1" } } as unknown as SharedExerciseState;
const durableAck = Object.freeze({
  exerciseId: "EX-ACK-1",
  revision: 1,
  packageId: identity.packageId,
  packageVersion: identity.packageVersion,
  bootstrapAuthorizationId: "BOOT-ACK-1",
});

function dependencies(overrides: Partial<AdminExerciseCreationDependencies> = {}): AdminExerciseCreationDependencies {
  const captureLocalState = jest.fn()
    .mockReturnValueOnce(beforeState)
    .mockReturnValueOnce(provisionalState);
  return {
    resolvePackage: () => AIRWAY_EXERCISE_PACKAGE,
    grantBootstrap: jest.fn().mockResolvedValue(undefined),
    refreshSession: jest.fn().mockResolvedValue(undefined),
    prepare: jest.fn().mockReturnValue({ ok: true, exerciseId: "EX-ACK-1", exercisePackage: AIRWAY_EXERCISE_PACKAGE }),
    captureLocalState,
    restoreLocalState: jest.fn(),
    acknowledge: jest.fn().mockResolvedValue(durableAck),
    ...overrides,
  };
}

describe("Admin exercise durable publication acknowledgement", () => {
  beforeEach(() => {
    resetAdminExerciseCreationAttemptsForTests();
    resetInitialExercisePublicationFenceForTests();
  });

  test("ADMIN-CREATE-ACK-01 UI orchestration does not succeed before durable backend ACK", async () => {
    let release!: () => void;
    const acknowledge = jest.fn(() => new Promise<typeof durableAck>(resolve => {
      release = () => resolve(durableAck);
    }));
    const creation = createAdminExercise("USER-1", identity, "OP-01", dependencies({ acknowledge }));
    await Promise.resolve(); await Promise.resolve();
    expect(getAdminExerciseCreationPhase("OP-01")).toBe("WAITING_FOR_BACKEND_ACK");
    let settled = false; void creation.finally(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    release(); await expect(creation).resolves.toBe("EX-ACK-1");
  });

  test("ADMIN-CREATE-ACK-02 initial exercise_states publication is required for success", async () => {
    const acknowledge = jest.fn().mockRejectedValue(new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT"));
    await expect(createAdminExercise("USER-1", identity, "OP-02", dependencies({ acknowledge })))
      .rejects.toThrow("Õppuse loomine ei õnnestunud");
    expect(getAdminExerciseCreationPhase("OP-02")).toBe("FAILED");
  });

  test("ADMIN-CREATE-ACK-03 bootstrap must be consumed before success", () => {
    expect(bootstrapConsumptionMatches({ id: "B", status: "ACTIVE", consumed_exercise_id: "EX-1",
      consumed_at: "2026-10-07T00:00:00Z", expires_at: "2026-10-07T00:10:00Z" }, "EX-1")).toBe(true);
    expect(bootstrapConsumptionMatches({ id: "B", status: "ACTIVE", consumed_exercise_id: null,
      consumed_at: null, expires_at: "2026-10-07T00:10:00Z" }, "EX-1")).toBe(false);
  });

  test("ADMIN-CREATE-ACK-04 discovery before initial publication does not erase pending create", () => {
    beginInitialExercisePublication({ operationId: "OP-04", exerciseId: "EX-NEW", packageIdentity: identity });
    expect(shouldPreservePendingInitialExercise("EX-NEW", "EX-HISTORICAL")).toBe(true);
    expect(shouldPreservePendingInitialExercise("EX-NEW", "EX-NEW")).toBe(false);
    finishInitialExercisePublication("OP-04");
  });

  test("ADMIN-CREATE-ACK-05 discovery after ACK resolves the same exercise", () => {
    expect(initialExerciseReadbackMatches({ exercise_id: "EX-ACK-1", revision: 1,
      exercise_session: { exerciseId: "EX-ACK-1", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 1 },
      exercise_package_reference: identity, updated_at: "2026-10-07T00:00:00Z" },
    "EX-ACK-1", identity.packageId, identity.packageVersion)).toBe(true);
  });

  test("ADMIN-CREATE-ACK-06 selected package identity is preserved through durable creation", async () => {
    const badAck = { ...durableAck, packageId: PELVIC_INJURY_EXERCISE_PACKAGE.packageId };
    await expect(createAdminExercise("USER-1", identity, "OP-06", dependencies({
      acknowledge: jest.fn().mockResolvedValue(badAck),
    }))).rejects.toThrow("Õppuse loomine ei õnnestunud");
  });

  test("ADMIN-CREATE-ACK-07 failed initial publication shows a bounded error", async () => {
    await expect(createAdminExercise("USER-1", identity, "OP-07", dependencies({
      acknowledge: jest.fn().mockRejectedValue(new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT")),
    }))).rejects.toThrow("Õppuse loomine ei õnnestunud. Proovi uuesti.");
  });

  test("ADMIN-CREATE-ACK-08 failed creation cannot reach the succeeded phase", async () => {
    await createAdminExercise("USER-1", identity, "OP-08", dependencies({
      acknowledge: jest.fn().mockRejectedValue(new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT")),
    })).catch(() => undefined);
    expect(getAdminExerciseCreationPhase("OP-08")).not.toBe("SUCCEEDED");
  });

  test("ADMIN-CREATE-ACK-09 double submit creates at most one durable exercise", async () => {
    const deps = dependencies();
    const first = createAdminExercise("USER-1", identity, "OP-09", deps);
    const second = createAdminExercise("USER-1", identity, "OP-09", deps);
    await expect(Promise.all([first, second])).resolves.toEqual(["EX-ACK-1", "EX-ACK-1"]);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledTimes(1);
  });

  test("ADMIN-CREATE-ACK-10 retry after transient failure reuses the provisional identity", async () => {
    const acknowledge = jest.fn()
      .mockRejectedValueOnce(new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT"))
      .mockResolvedValueOnce(durableAck);
    const deps = dependencies({ acknowledge });
    await createAdminExercise("USER-1", identity, "OP-10", deps).catch(() => undefined);
    await expect(createAdminExercise("USER-1", identity, "OP-10", deps)).resolves.toBe("EX-ACK-1");
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.grantBootstrap).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  test("ADMIN-CREATE-ACK-11 consumed bootstrap operation cannot be reused for another create", async () => {
    const deps = dependencies();
    await createAdminExercise("USER-1", identity, "OP-11", deps);
    await createAdminExercise("USER-1", identity, "OP-11", deps);
    expect(deps.grantBootstrap).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledTimes(1);
  });

  test("ADMIN-CREATE-ACK-12 failed create has no writer-lease acquisition path", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/admin/PlatformAdminExerciseCreation.ts"), "utf8");
    expect(source).not.toMatch(/acquireRuntimeWriter|runtime_writer_leases|grantExerciseRole/);
  });

  test("ADMIN-CREATE-ACK-13 failed create has no GLOBAL or scoped role-grant path", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/admin/PlatformAdminExerciseCreation.ts"), "utf8");
    expect(source).not.toMatch(/grantExerciseRole|scopeType:\s*["']GLOBAL/);
  });

  test("ADMIN-CREATE-ACK-14 restart readback accepts only the durable matching exercise", () => {
    const matching = { exercise_id: "EX-ACK-1", revision: 1,
      exercise_session: { exerciseId: "EX-ACK-1", lifecycleState: "READY" as const, simulationTimeSec: 0, speed: 1 as const, version: 1 },
      exercise_package_reference: identity, updated_at: "2026-10-07T00:00:00Z" };
    expect(initialExerciseReadbackMatches(matching, "EX-ACK-1", identity.packageId, identity.packageVersion)).toBe(true);
    expect(initialExerciseReadbackMatches(matching, "EX-GHOST", identity.packageId, identity.packageVersion)).toBe(false);
  });

  test("ADMIN-CREATE-ACK-15 failed provisional creation restores the pre-create state", async () => {
    const restoreLocalState = jest.fn();
    await createAdminExercise("USER-1", identity, "OP-15", dependencies({
      restoreLocalState,
      acknowledge: jest.fn().mockRejectedValue(new Error("ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT")),
    })).catch(() => undefined);
    expect(restoreLocalState).toHaveBeenLastCalledWith(beforeState);
  });

  test("ADMIN-CREATE-ACK-16 package-routing selection remains external to creation acknowledgement", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/admin/PlatformAdminExerciseCreation.ts"), "utf8");
    expect(source).toContain("resolvePackage(identity)");
    expect(source).toContain("selected.packageHash");
    expect(source).not.toContain("activateWithResult(\"russicaptor.narva-trauma\"");
  });
});
