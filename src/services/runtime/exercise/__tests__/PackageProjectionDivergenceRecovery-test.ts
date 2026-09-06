import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { createRuntimeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import {
  evaluatePackageProjectionDivergence,
  PackageProjectionDivergenceRecoveryService,
  type ExerciseProjectionRecord,
  type PackageDivergenceRecoveryRepository,
} from "../PackageProjectionDivergenceRecoveryService";

function state(packageId = "PACKAGE-A", overrides: Partial<SharedExerciseState> = {}): SharedExerciseState {
  const exerciseId = "EX-1";
  const payload = { simulationTimeSec: 12 };
  return {
    exerciseSession: { exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 12, version: 802 } as never,
    exercisePackageReference: { packageId, packageVersion: "1.0.0" },
    patients: [{ id: "PT-1", name: "Patient" } as never], assignments: [], transfers: [], questions: [], labs: [],
    imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
    persistedRuntimeStates: [{ schemaVersion: 1, provenance: { exerciseId, patientId: "PT-1", packageId, packageVersion: "1.0.0", packageHash: "pkg", definitionHash: "def", moduleCompositionHash: "modules" }, capturedAtSimulationTimeSec: 12, payload, payloadHash: sha256Text(stableJson(payload)) } as never],
    ...overrides,
  };
}

function fixture() {
  const checkpoint = createRuntimeCheckpoint(state("PACKAGE-A"), 18);
  const projection: ExerciseProjectionRecord = Object.freeze({ exerciseId: "EX-1", revision: 17, state: state("PACKAGE-B") });
  return { checkpoint, projection };
}

describe("package projection/checkpoint divergence recovery", () => {
  test("same session/lifecycle, distinct complete package identities and no lease is the exact eligible state", () => {
    const { projection, checkpoint } = fixture();
    const result = evaluatePackageProjectionDivergence(projection, checkpoint, true, false);
    expect(result.code).toBe("ELIGIBLE");
    expect(result.expectation).toMatchObject({ exerciseId: "EX-1", projectionRevision: 17, checkpointRevision: 18,
      sessionVersion: 802, lifecycle: "RUNNING", projectionPackage: { packageId: "PACKAGE-B" }, checkpointPackage: { packageId: "PACKAGE-A" } });
  });

  test.each([
    ["active lease", true, undefined, "ACTIVE_LEASE_PRESENT"],
    ["missing checkpoint", false, "missing", "MISSING_CHECKPOINT"],
    ["invalid checkpoint", false, "invalid", "CHECKPOINT_INVALID"],
  ] as const)("rejects %s", (_label, activeLease, mode, code) => {
    const { projection, checkpoint } = fixture();
    expect(evaluatePackageProjectionDivergence(projection, mode === "missing" ? undefined : checkpoint,
      mode !== "invalid", activeLease)).toEqual({ code });
  });

  test("rejects matching packages, session mismatch, lifecycle conflict and ambiguous identity", () => {
    const { checkpoint } = fixture();
    expect(evaluatePackageProjectionDivergence({ exerciseId: "EX-1", revision: 1, state: state("PACKAGE-A") }, checkpoint, true, false)).toEqual({ code: "NOT_DIVERGENT" });
    expect(evaluatePackageProjectionDivergence({ exerciseId: "EX-1", revision: 1, state: state("PACKAGE-B", { exerciseSession: { ...state().exerciseSession, version: 803 } as never }) }, checkpoint, true, false)).toEqual({ code: "SESSION_VERSION_MISMATCH" });
    expect(evaluatePackageProjectionDivergence({ exerciseId: "EX-1", revision: 1, state: state("PACKAGE-B", { exerciseSession: { ...state().exerciseSession, lifecycleState: "PAUSED" } as never }) }, checkpoint, true, false)).toEqual({ code: "LIFECYCLE_CONFLICT" });
    expect(evaluatePackageProjectionDivergence({ exerciseId: "EX-1", revision: 1, state: { ...state("PACKAGE-B"), exercisePackageReference: undefined } }, checkpoint, true, false)).toEqual({ code: "PACKAGE_IDENTITY_AMBIGUOUS" });
  });

  test("fully validates checkpoint before invoking audited terminalization", async () => {
    const { checkpoint, projection } = fixture();
    let currentProjection = projection;
    const terminalize = jest.fn(async () => {
      currentProjection = Object.freeze({ ...projection, state: { ...projection.state,
        exerciseSession: { ...projection.state.exerciseSession, lifecycleState: "COMPLETED" } as never } });
      return Object.freeze({ code: "TERMINALIZED_DIVERGENT_STATE" as const, auditId: "AUDIT-1", state: currentProjection.state });
    });
    const repository: PackageDivergenceRecoveryRepository = {
      loadProjection: async () => currentProjection,
      loadCheckpoint: async () => structuredClone(checkpoint),
      hasActiveWriterLease: async () => false,
      terminalize,
    };
    const service = new PackageProjectionDivergenceRecoveryService(repository, async () => undefined);
    await expect(service.terminalize("EX-1"))
      .resolves.toMatchObject({ code: "TERMINALIZED_DIVERGENT_STATE", auditId: "AUDIT-1" });
    expect(terminalize).toHaveBeenCalledTimes(1);
    await expect(service.terminalize("EX-1")).resolves.toEqual({ code: "ALREADY_TERMINAL" });
    expect(terminalize).toHaveBeenCalledTimes(1);
  });

  test("corrupt root, Runtime artifact and provenance stay fail closed without RPC", async () => {
    const { checkpoint, projection } = fixture();
    const badRuntimePayload = { ...structuredClone(checkpoint.payload),
      persistedRuntimeStates: checkpoint.payload.persistedRuntimeStates?.map((item, index) =>
        index === 0 ? { ...item, payloadHash: "0".repeat(64) } : item) };
    const badRuntime = { ...structuredClone(checkpoint), payload: badRuntimePayload,
      payloadHash: sha256Text(stableJson(badRuntimePayload)) };
    const variants = [
      { ...structuredClone(checkpoint), payloadHash: "0".repeat(64) },
      badRuntime,
      { ...structuredClone(checkpoint), provenanceHash: "0".repeat(64) },
    ];
    for (const corrupt of variants) {
      const terminalize = jest.fn();
      const repository: PackageDivergenceRecoveryRepository = { loadProjection: async () => projection,
        loadCheckpoint: async () => corrupt as never, hasActiveWriterLease: async () => false, terminalize };
      await expect(new PackageProjectionDivergenceRecoveryService(repository, async () => undefined).terminalize("EX-1"))
        .resolves.toEqual({ code: "CHECKPOINT_INVALID" });
      expect(terminalize).not.toHaveBeenCalled();
    }
  });
});
