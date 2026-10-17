import fs from "node:fs";
import path from "node:path";
import { createAdminExercise, resetAdminExerciseCreationAttemptsForTests,
  getAdminExerciseCreationDiagnostic, discardAdminExerciseCreationOperation,
  type AdminExerciseCreationDependencies } from "../PlatformAdminExerciseCreation";
import { createSharedExerciseProjection, createSharedExerciseSnapshot, captureAdminExerciseProjection,
  restoreSharedExerciseState, restoreAdminExerciseProjection } from "@/services/StatePersistenceService";
import { prepareProvisionalAdminExercise } from "@/services/exercise/ExercisePreparationService";
import { exercisePackageRegistry, exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { createPatientMaterializationPlan, installPatientMaterialization,
  restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { clearActiveClinicalReferenceRuntime, prepareActiveClinicalReferenceRuntime,
  captureActiveClinicalReferenceRuntimesAsync, getActiveClinicalReferenceRuntimeClocks } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import { advanceExerciseClockTargets } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCurrentExercise, installCurrentExercise } from "@/repositories/ExerciseRepository";
import { getRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from "@/services/runtime/commands/RuntimePatientCommandCursor";
import { shouldPreservePendingInitialExercise, resetInitialExercisePublicationFenceForTests } from "@/services/exercise/InitialExercisePublicationFence";
import { getCompletedExerciseArchives, restoreCompletedExerciseArchives,
  type CompletedExerciseArchive } from "@/services/exercise/CompletedExerciseArchiveService";
jest.mock("@/services/SupabaseService", () => ({ supabase: undefined,
  synchronizeRealtimeAuthorization: jest.fn(async () => false) }));

const identity = { packageId: "russicaptor.builder-picker-test153", packageVersion: "1.0.0" };
const pkg = exercisePackageRegistry.get(identity.packageId, identity.packageVersion)!;
const oldId = "EX-SNAPSHOT-OLD";
const op = "ADMIN-CREATE-SNAPSHOT-NEW";
const newId = "EX-SNAPSHOT-NEW";
const user = "LOCAL-ONLY-ADMIN";
function session(clock: number, lifecycleState: "READY" | "RUNNING" | "COMPLETED" = "READY") {
  replaceCanonicalExerciseSnapshot({ exerciseId: oldId, lifecycleState, simulationTimeSec: clock,
    speed: 1, version: 7, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 });
}
function runtime(clock = 0, id = oldId) {
  exercisePackageLoader.bind(id, pkg);
  const plan = createPatientMaterializationPlan(id, pkg, packagePatientDatasetRegistry);
  installPatientMaterialization({ ...plan, patients: plan.patients.slice(0, 1) });
  prepareActiveClinicalReferenceRuntime(id);
  if (clock) advanceExerciseClockTargets(0, clock);
}
function dependencies(): AdminExerciseCreationDependencies {
  return {
    detachedPreparation: true,
    resolvePackage: () => pkg,
    captureLocalState: jest.fn(captureAdminExerciseProjection),
    currentExerciseId: () => getCanonicalExerciseSnapshot().exerciseId,
    restoreLocalState: jest.fn(restoreAdminExerciseProjection),
    grantBootstrap: jest.fn(async () => ({ id: "LOCAL-BOOT", user_id: user, status: "ACTIVE" as const,
      consumed_exercise_id: null, expires_at: "2099-01-01T00:00:00Z" })),
    revokeBootstrap: jest.fn(async () => undefined),
    prepare: jest.fn((_identity, operationId, exerciseId) => ({ ok: true as const,
      exerciseId, exercisePackage: pkg,
      projection: prepareProvisionalAdminExercise(`PREPARE-${operationId}`, exerciseId, pkg) })),
    acknowledge: jest.fn(async input => ({ exerciseId: input.exerciseId, revision: 1,
      packageId: input.packageId, packageVersion: input.packageVersion,
      bootstrapAuthorizationId: input.bootstrapAuthorizationId })),
  };
}
async function success(d = dependencies()) {
  await expect(createAdminExercise(user, identity, op, d)).resolves.toBe(newId);
  expect(d.grantBootstrap).toHaveBeenCalledTimes(1);
  expect(d.acknowledge).toHaveBeenCalledTimes(1);
  expect(d.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ projection: expect.objectContaining({
    exerciseSession: expect.objectContaining({ lifecycleState: "READY", simulationTimeSec: 0, version: 1 }),
    exercisePackageReference: identity,
  }) }));
  return d;
}
describe("Admin detached creation snapshot isolation", () => {
  let warn: jest.SpyInstance;
  let network: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    network = jest.spyOn(global, "fetch").mockImplementation(() => { throw new Error("NETWORK_FORBIDDEN"); });
    resetAdminExerciseCreationAttemptsForTests(); clearActiveClinicalReferenceRuntime(); restorePatientMaterialization(); session(0);
    installCurrentExercise(oldId, "Old local exercise", pkg);
    resetInitialExercisePublicationFenceForTests();
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled(); network.mockRestore(); warn.mockRestore();
    clearActiveClinicalReferenceRuntime(); restorePatientMaterialization();
  });
  test("clean previous runtime", async () => { runtime(); await success(); });
  test("no previous runtime", async () => { session(4328); await success(); });
  test("completed previous exercise", async () => { runtime(); session(0, "COMPLETED"); await success(); });
  test("stale previous runtime clock", async () => { runtime(10); session(20); await success(); });
  test("exact 4328/[4317] integrity failure remains enforced but does not block detached creation", async () => {
    runtime(4317); session(4328);
    await expect(captureActiveClinicalReferenceRuntimesAsync(4328, async () => undefined, oldId)).rejects.toMatchObject({
      message: "RUNTIME_CHECKPOINT_CLOCK_MISMATCH", expectedSimulationTimeSec: 4328, observedRuntimeClocks: [4317] });
    expect(() => createSharedExerciseSnapshot()).toThrow("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
    await success(); expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([4317]);
  });
  test("foreign previous runtime is not recaptured or rewritten", async () => {
    runtime(0, "EX-FOREIGN"); await success(); expect(getActiveClinicalReferenceRuntimeClocks("EX-FOREIGN")).toEqual([0]);
  });
  test("partially initialized previous runtime", async () => {
    installPatientMaterialization(createPatientMaterializationPlan(oldId, pkg, packagePatientDatasetRegistry)); await success();
  });
  test("restored previous RUNNING state", async () => {
    runtime(12); session(12, "RUNNING"); const persisted = JSON.parse(JSON.stringify(createSharedExerciseSnapshot()));
    clearActiveClinicalReferenceRuntime(); restoreSharedExerciseState(persisted, false);
    session(23); await success(); expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([12]);
  });
  test.each([
    ["LOCAL_PREPARATION", "prepare", "LOCAL_PREPARATION_FAILURE"],
    ["PACKAGE_VALIDATION", "prepare", "ADMIN_EXERCISE_PACKAGE_INCOMPATIBLE"],
    ["BOOTSTRAP_AUTHORIZATION", "grantBootstrap", "BOOTSTRAP_GRANT_FAILED"],
    ["SERVER_CREATION", "acknowledge", "ADMIN_EXERCISE_INITIAL_INSERT_FAILED"],
    ["INITIAL_PUBLICATION", "acknowledge", "ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT"],
  ] as const)("%s failure preserves exact previous projection and engine clocks", async (stage, method, code) => {
    runtime(4317); session(4328); const before = createSharedExerciseProjection(); const d = dependencies();
    if (method === "prepare") (d.prepare as jest.Mock).mockImplementation(() => { throw new Error(code); });
    else (d[method] as jest.Mock).mockRejectedValue(new Error(code));
    await expect(createAdminExercise(user, identity, op, d)).rejects.toMatchObject({ diagnostic: { stage,
      code: code === "LOCAL_PREPARATION_FAILURE" ? "ADMIN_CREATION_LOCAL_PREPARATION_FAILED" : code,
      durableConfirmed: false } });
    expect(createSharedExerciseProjection()).toEqual(before);
    expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([4317]);
    expect(d.restoreLocalState).not.toHaveBeenCalled();
    expect(d.captureLocalState).not.toHaveBeenCalled();
  });
  test("failed activation rolls back projection without rehydrating, recapturing or rewinding old engines", async () => {
    runtime(4317); session(4328); const before = createSharedExerciseProjection(); const d = dependencies();
    (d.restoreLocalState as jest.Mock).mockImplementationOnce(state => { restoreAdminExerciseProjection(state); throw new Error("LOCAL_FAILURE"); });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toMatchObject({ diagnostic: { stage: "LOCAL_ACTIVATION", durableConfirmed: true } });
    expect(createSharedExerciseProjection()).toEqual(before);
    expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([4317]);
    await success(d); expect(d.revokeBootstrap).not.toHaveBeenCalled();
  });
  test("rollback failure retains backup, refuses discard and retries rollback before local activation only", async () => {
    runtime(4317); session(4328); const before = createSharedExerciseProjection(); const d = dependencies();
    (d.restoreLocalState as jest.Mock)
      .mockImplementationOnce(state => { restoreAdminExerciseProjection(state); throw new Error("ACTIVATION_FAILURE"); })
      .mockImplementationOnce(() => { throw new Error("ROLLBACK_FAILURE"); });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toMatchObject({ diagnostic: { stage: "ROLLBACK", durableConfirmed: true } });
    expect(discardAdminExerciseCreationOperation(op)).toBe(false);
    (d.restoreLocalState as jest.Mock).mockImplementationOnce(state => {
      expect(state).toMatchObject(before); restoreAdminExerciseProjection(state);
    });
    await success(d); expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([4317]);
  });
  test("fresh backup is captured after the async ACK, not before older state can progress", async () => {
    runtime(10); session(20); const d = dependencies();
    (d.acknowledge as jest.Mock).mockImplementation(async input => {
      expect(d.captureLocalState).not.toHaveBeenCalled(); session(30);
      return { exerciseId: input.exerciseId, revision: 1, ...identity, bootstrapAuthorizationId: "LOCAL-BOOT" };
    });
    (d.restoreLocalState as jest.Mock).mockImplementationOnce(() => { throw new Error("LOCAL_FAILURE"); });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toThrow();
    expect(getCanonicalExerciseSnapshot()).toMatchObject({ exerciseId: oldId, simulationTimeSec: 30 });
  });
  test("local backup failure after ACK cannot cause a second bootstrap or creation", async () => {
    const d = dependencies(); (d.captureLocalState as jest.Mock).mockImplementationOnce(() => { throw new Error("LOCAL_FAILURE"); });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toMatchObject({ diagnostic: { stage: "LOCAL_ACTIVATION", durableConfirmed: true } });
    await success(d);
  });
  test("concurrent double submit and successful retry create exactly once", async () => {
    const d = dependencies();
    await expect(Promise.all([createAdminExercise(user, identity, op, d), createAdminExercise(user, identity, op, d)]))
      .resolves.toEqual([newId, newId]); await success(d);
  });
  test("pending detached creation defers both historical and new discovery rows until ACK", async () => {
    const d = dependencies();
    (d.acknowledge as jest.Mock).mockImplementation(async input => {
      expect(shouldPreservePendingInitialExercise(oldId, newId)).toBe(true);
      expect(shouldPreservePendingInitialExercise(oldId, "EX-HISTORY")).toBe(true);
      expect(d.restoreLocalState).not.toHaveBeenCalled();
      return { exerciseId: input.exerciseId, revision: 1, ...identity, bootstrapAuthorizationId: "LOCAL-BOOT" };
    });
    await success(d); expect(shouldPreservePendingInitialExercise(oldId, newId)).toBe(false);
  });
  test("production creation discovery is scoped readback, not global hydration", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const discover = source.slice(source.indexOf("discover: async exerciseId =>"), source.indexOf("wait: delay,"));
    expect(discover).toContain('.eq("exercise_id", exerciseId).maybeSingle()');
    expect(discover).not.toContain("refreshRemoteCurrentExercise(");
    expect(discover).not.toContain("restoreSharedExerciseState(");
  });
  test("missing package reports bounded validation failure before any bootstrap", async () => {
    const d = dependencies();
    const resolvePackage = jest.fn(() => undefined);
    await expect(createAdminExercise(user, identity, op, { ...d, resolvePackage })).rejects
      .toMatchObject({ diagnostic: { stage: "PACKAGE_VALIDATION", durableConfirmed: false } });
    expect(d.grantBootstrap).not.toHaveBeenCalled();
  });
  test("activation and rollback preserve historical archives that are not part of the active projection", async () => {
    const archive = { exerciseId: "EX-HISTORY", snapshot: { exerciseId: "EX-HISTORY" } } as CompletedExerciseArchive;
    restoreCompletedExerciseArchives([archive]);
    const d = dependencies();
    (d.restoreLocalState as jest.Mock).mockImplementationOnce(state => {
      restoreAdminExerciseProjection(state); throw new Error("ACTIVATION_FAILURE");
    });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toThrow();
    expect(getCompletedExerciseArchives()).toEqual([archive]);
    await success(d); expect(getCompletedExerciseArchives()).toEqual([archive]);
    restoreCompletedExerciseArchives([]);
  });
  test("rollback preserves prior exercise metadata and durable command cursor without recapturing engines", async () => {
    runtime(4317); session(4328);
    getCurrentExercise().description = "Preserved description";
    restoreRuntimePatientCommandCursor(oldId, 42);
    const beforeIdentity = { ...getCurrentExercise() };
    const d = dependencies();
    (d.restoreLocalState as jest.Mock).mockImplementationOnce(state => {
      restoreAdminExerciseProjection(state); throw new Error("ACTIVATION_FAILURE");
    });
    await expect(createAdminExercise(user, identity, op, d)).rejects.toThrow();
    expect(getCurrentExercise()).toEqual(beforeIdentity);
    expect(getRuntimePatientCommandCursor(oldId)).toBe(42);
    expect(getActiveClinicalReferenceRuntimeClocks(oldId)).toEqual([4317]);
  });
  test("structured diagnostics redact arbitrary exception text and carry only bounded fields", async () => {
    const d = dependencies(); (d.acknowledge as jest.Mock).mockRejectedValue(new Error("PRIVATE_TOKEN_AND_PATIENT_CONTENT"));
    await expect(createAdminExercise(user, identity, op, d)).rejects.toThrow();
    expect(getAdminExerciseCreationDiagnostic(op)).toEqual({ stage: "INITIAL_PUBLICATION",
      code: "ADMIN_CREATION_INITIAL_PUBLICATION_FAILED", durableConfirmed: false });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE_TOKEN");
  });
  test("production default uses projection-only backup and has no writer/role/direct-write fallback", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/admin/PlatformAdminExerciseCreation.ts"), "utf8");
    expect(source).not.toContain("createSharedExerciseSnapshot");
    expect(source).toContain("detachedPreparation: true");
    expect(source).not.toMatch(/acquireRuntimeWriter|grantExerciseRole|\.from\(/);
  });
});
