import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { getExerciseControlReplayHash, resetExerciseControlCommandHandler } from "../ExerciseControlCommandHandler";
import { validateExerciseClock } from "../ExerciseClockIntegrityValidator";
import { executeExerciseReset, getArchivedExerciseSnapshot, getExerciseResetAudit, resetExerciseResetService } from "../ExerciseResetService";

const canonical = (patch: Partial<CanonicalExerciseSnapshot> = {}): CanonicalExerciseSnapshot => ({ exerciseId: "EX-1", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, version: 4, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0, ...patch });

describe("WP-24A canonical Exercise Clock integrity", () => {
  beforeEach(() => { resetExerciseResetService(); resetExerciseControlCommandHandler(); replaceCanonicalExerciseSnapshot(canonical()); });

  it("detects legacy snapshots without rewriting them", () => {
    const legacy = canonical({ clockVersion: undefined, clockInitializedAtSimulationTimeSec: undefined, simulationTimeSec: 2_622_290 }); const before = structuredClone(legacy);
    const result = validateExerciseClock(legacy);
    expect(result).toMatchObject({ valid: true, migrationStatus: "MIGRATION_AVAILABLE" });
    expect(result.diagnostics.map(item => item.code)).toEqual(["CLOCK_VERSION_MISSING"]);
    expect(legacy).toEqual(before);
  });

  it("validates canonical state, ownership, monotonicity and completed immutability", () => {
    expect(validateExerciseClock(canonical(), { ownerExerciseId: "EX-1" })).toMatchObject({ valid: true, migrationStatus: "CANONICAL" });
    expect(validateExerciseClock(canonical(), { ownerExerciseId: "OTHER" }).diagnostics[0].code).toBe("OWNER_MISMATCH");
    expect(validateExerciseClock(canonical({ simulationTimeSec: 9 }), { previous: canonical({ simulationTimeSec: 10 }) }).diagnostics.some(item => item.code === "CLOCK_REGRESSION")).toBe(true);
    expect(validateExerciseClock(canonical({ lifecycleState: "RUNNING", simulationTimeSec: 11 }), { previous: canonical({ lifecycleState: "COMPLETED", simulationTimeSec: 10 }) }).diagnostics.some(item => item.code === "COMPLETED_CLOCK_MUTATED")).toBe(true);
    expect(validateExerciseClock(canonical({ simulationTimeSec: -1 })).valid).toBe(false);
  });

  it("rejects active reset and preserves a completed historical snapshot", () => {
    replaceCanonicalExerciseSnapshot(canonical({ lifecycleState: "RUNNING", simulationTimeSec: 20 }));
    const active = executeExerciseReset({ commandId: "RESET-A", currentExerciseId: "EX-1", newExerciseId: "EX-2", issuedBy: "Exercise Controller", expectedVersion: 4 });
    expect(active).toMatchObject({ ok: false, audit: { reasonCode: "ACTIVE_EXERCISE" } }); expect(getCanonicalExerciseSnapshot().exerciseId).toBe("EX-1");
    replaceCanonicalExerciseSnapshot(canonical({ lifecycleState: "COMPLETED", simulationTimeSec: 50 }));
    const reset = executeExerciseReset({ commandId: "RESET-B", currentExerciseId: "EX-1", newExerciseId: "EX-2", issuedBy: "Exercise Controller", expectedVersion: 4 });
    expect(reset).toMatchObject({ ok: true, snapshot: { exerciseId: "EX-2", lifecycleState: "READY", simulationTimeSec: 0, speed: 1, clockVersion: 2 } });
    expect(getArchivedExerciseSnapshot("EX-1")).toEqual(canonical({ lifecycleState: "COMPLETED", simulationTimeSec: 50 }));
    expect(executeExerciseReset({ commandId: "RESET-B", currentExerciseId: "EX-1", newExerciseId: "EX-2", issuedBy: "Exercise Controller", expectedVersion: 4 })).toEqual(reset);
    expect(getExerciseResetAudit()).toHaveLength(2);
  });

  it("keeps legacy and canonical clock metadata outside existing replay hashes", () => {
    replaceCanonicalExerciseSnapshot(canonical({ clockVersion: undefined, clockInitializedAtSimulationTimeSec: undefined })); const legacyHash = getExerciseControlReplayHash();
    replaceCanonicalExerciseSnapshot(canonical()); expect(getExerciseControlReplayHash()).toBe(legacyHash);
    const legacyDebrief = reconstructDebrief({ exercise: canonical({ clockVersion: undefined, clockInitializedAtSimulationTimeSec: undefined }), patients: [], timeline: [] });
    const canonicalDebrief = reconstructDebrief({ exercise: canonical(), patients: [], timeline: [] });
    expect(canonicalDebrief.generatedFromReplayHash).toBe(legacyDebrief.generatedFromReplayHash);
    expect(legacyDebrief.clockMigrationStatus).toBe("MIGRATION_AVAILABLE"); expect(canonicalDebrief.clockMigrationStatus).toBe("CANONICAL");
  });

  it("validates 1000 snapshots without mutation", () => {
    const snapshots = Array.from({ length: 1000 }, (_, index) => canonical({ simulationTimeSec: index })); const before = JSON.stringify(snapshots);
    expect(snapshots.map(snapshot => validateExerciseClock(snapshot)).every(result => result.valid)).toBe(true); expect(JSON.stringify(snapshots)).toBe(before);
  });
});
