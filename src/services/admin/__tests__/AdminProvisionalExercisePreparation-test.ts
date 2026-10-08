import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { createExercisePreparationCommand, exercisePreparationService,
  prepareProvisionalAdminExercise } from "@/services/exercise/ExercisePreparationService";
import { acknowledgeInitialExercisePublication, type InitialExercisePublicationPort } from "@/services/CloudSyncService";
import { beginInitialExercisePublication, finishInitialExercisePublication,
  resetInitialExercisePublicationFenceForTests } from "@/services/exercise/InitialExercisePublicationFence";
import { createAdminExercise, discardAdminExerciseCreationOperation, resetAdminExerciseCreationAttemptsForTests,
  type AdminExerciseCreationDependencies } from "../PlatformAdminExerciseCreation";

const pkg = NARVA_TRAUMA_EXERCISE_PACKAGE;
const identity = { packageId: pkg.packageId, packageVersion: pkg.packageVersion };
const oldExercise = { exerciseId: "EX-OLD-READY", lifecycleState: "READY" as const,
  simulationTimeSec: 0, speed: 1 as const, version: 4, clockVersion: 2 as const };
const grant = { id: "BOOT-PROVISIONAL", user_id: "ADMIN", status: "ACTIVE" as const,
  consumed_exercise_id: null, expires_at: "2099-01-01T00:00:00Z" };

describe("ADMIN-PREP detached Admin creation", () => {
  beforeEach(() => {
    resetAdminExerciseCreationAttemptsForTests();
    resetInitialExercisePublicationFenceForTests();
    replaceCanonicalExerciseSnapshot(oldExercise);
  });

  test("01/02/03 existing READY remains unchanged and provisional identity differs", () => {
    const before = getCanonicalExerciseSnapshot();
    const prepared = prepareProvisionalAdminExercise("PREPARE-B", "EX-NEW-B", pkg);
    expect(prepared.exerciseSession.exerciseId).toBe("EX-NEW-B");
    expect(prepared.exerciseSession.exerciseId).not.toBe(before.exerciseId);
    expect(getCanonicalExerciseSnapshot()).toEqual(before);
  });

  test("04/05 package and bootstrap publication target only provisional identity", async () => {
    const projection = prepareProvisionalAdminExercise("PREPARE-B", "EX-NEW-B", pkg);
    expect(projection.patientMaterialization).toMatchObject({ exerciseId: "EX-NEW-B",
      packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageHash: pkg.packageHash });
    expect(projection.patients).toHaveLength(2);
    expect(projection.questions).toHaveLength(6);
    expect(projection.imagingStudies).toHaveLength(1);
    expect(projection.orders).toHaveLength(1);
    expect(projection.questions.every(question => question.exerciseId === "EX-NEW-B")).toBe(true);
    expect(projection.imagingStudies.every(study => study.exerciseId === "EX-NEW-B")).toBe(true);
    const inserted: SharedExerciseState[] = [];
    const port: InitialExercisePublicationPort = {
      authenticatedUserId: async () => "ADMIN",
      projection: () => { throw new Error("existing store must not be read"); },
      readExercise: async exerciseId => inserted.length ? { exercise_id: exerciseId, revision: 1,
        exercise_session: inserted[0].exerciseSession,
        exercise_package_reference: inserted[0].exercisePackageReference,
        updated_at: "2026-10-08T00:00:00Z" } : undefined,
      readBootstrap: async () => ({ id: grant.id, status: "ACTIVE",
        consumed_exercise_id: inserted.length ? "EX-NEW-B" : null,
        consumed_at: inserted.length ? "2026-10-08T00:00:00Z" : null,
        expires_at: grant.expires_at }),
      insert: async row => { inserted.push(row.state); },
      discover: async () => true,
      wait: async () => undefined,
    };
    beginInitialExercisePublication({ operationId: "OP-B", exerciseId: "EX-NEW-B", packageIdentity: identity });
    await expect(acknowledgeInitialExercisePublication({ operationId: "OP-B", userId: "ADMIN",
      exerciseId: "EX-NEW-B", packageId: pkg.packageId, packageVersion: pkg.packageVersion,
      bootstrapAuthorizationId: grant.id, projection }, port)).resolves.toMatchObject({ exerciseId: "EX-NEW-B" });
    finishInitialExercisePublication("OP-B");
    expect(inserted).toHaveLength(1);
    expect(inserted[0].exerciseSession.exerciseId).toBe("EX-NEW-B");
    expect(getCanonicalExerciseSnapshot()).toEqual(oldExercise);
  });

  test("06/07/08 cancel and failed Admin creation discard only provisional state", async () => {
    const before = getCanonicalExerciseSnapshot();
    // Cancelling the UI before submission never creates a provisional context.
    expect(discardAdminExerciseCreationOperation("OP-NOT-STARTED")).toBe(true);
    expect(getCanonicalExerciseSnapshot()).toEqual(before);
    const projection = prepareProvisionalAdminExercise("PREPARE-C", "EX-NEW-C", pkg);
    const restore = jest.fn();
    const revoke = jest.fn().mockResolvedValue(undefined);
    const deps: AdminExerciseCreationDependencies = {
      resolvePackage: () => pkg,
      grantBootstrap: async () => grant,
      revokeBootstrap: revoke,
      prepare: () => ({ ok: true, exerciseId: "EX-NEW-C", exercisePackage: pkg, projection }),
      captureLocalState: () => ({ exerciseSession: before } as SharedExerciseState),
      restoreLocalState: restore,
      acknowledge: async () => { throw new Error("ADMIN_EXERCISE_INITIAL_INSERT_FAILED"); },
    };
    await expect(createAdminExercise("ADMIN", identity, "ADMIN-CREATE-NEW-C", deps)).rejects.toThrow("Õppuse loomine ei õnnestunud");
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ exerciseSession: before }));
    expect(revoke).toHaveBeenCalledWith(grant.id, "ADMIN");
    expect(getCanonicalExerciseSnapshot()).toEqual(before);
    expect(discardAdminExerciseCreationOperation("ADMIN-CREATE-NEW-C")).toBe(true);
  });

  test("09/10 generic preparation still refuses arbitrary READY overwrite", () => {
    const command = createExercisePreparationCommand();
    expect(exercisePreparationService.prepare(command)).toMatchObject({ ok: false,
      code: "INVALID_EXERCISE_STATE" });
    expect(getCanonicalExerciseSnapshot()).toEqual(oldExercise);
  });

  test("11/12/13 Admin reaches ACK with exact package and does not switch before ACK", async () => {
    const projection = prepareProvisionalAdminExercise("PREPARE-D", "EX-NEW-D", pkg);
    const before = getCanonicalExerciseSnapshot();
    let release!: () => void;
    const restore = jest.fn();
    const deps: AdminExerciseCreationDependencies = {
      resolvePackage: () => pkg,
      grantBootstrap: async () => grant,
      revokeBootstrap: async () => undefined,
      prepare: () => ({ ok: true, exerciseId: "EX-NEW-D", exercisePackage: pkg, projection }),
      captureLocalState: () => ({ exerciseSession: before } as SharedExerciseState),
      restoreLocalState: restore,
      acknowledge: input => new Promise(resolve => {
        expect(input).toMatchObject({ exerciseId: "EX-NEW-D", packageId: pkg.packageId,
          packageVersion: pkg.packageVersion, bootstrapAuthorizationId: grant.id, projection });
        release = () => resolve({ exerciseId: "EX-NEW-D", revision: 1,
          packageId: pkg.packageId, packageVersion: pkg.packageVersion,
          bootstrapAuthorizationId: grant.id });
      }),
    };
    const created = createAdminExercise("ADMIN", identity, "ADMIN-CREATE-NEW-D", deps);
    await Promise.resolve(); await Promise.resolve();
    expect(getCanonicalExerciseSnapshot()).toEqual(before);
    expect(restore).not.toHaveBeenCalled();
    release();
    await expect(created).resolves.toBe("EX-NEW-D");
    expect(restore).toHaveBeenCalledWith(projection);
  });
});
