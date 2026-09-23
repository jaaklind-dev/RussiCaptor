import {
  assertActiveRuntimeExerciseIdentity,
  captureActiveClinicalReferenceRuntimes,
  clearActiveClinicalReferenceRuntime,
  createCanonicalBaselineRuntimeFixture,
  prepareActiveClinicalReferenceRuntime,
} from "../ClinicalReferenceRuntimeService";
import { DEFAULT_EXERCISE_PACKAGE, HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1 } from "@/services/exercise/CanonicalExercisePackages";
import { createPatientMaterializationPlan, installPatientMaterialization, restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { checkpointEnvelopePreparationDecision } from "@/services/StatePersistenceService";

describe("clinical reference Runtime exercise identity", () => {
  afterEach(() => {
    clearActiveClinicalReferenceRuntime();
    restorePatientMaterialization();
    exercisePackageLoader.unbind("EX-RB2-IMAGING");
    exercisePackageLoader.unbind("EX-RB2-NO-IMAGING");
  });

  test("accepts Runtime bindings belonging to the current exercise", () => {
    expect(() => assertActiveRuntimeExerciseIdentity(
      [{ exerciseId: "EX-B" }, { exerciseId: "EX-B" }],
      "EX-B",
    )).not.toThrow();
  });

  test("classifies a cross-exercise capture as identity mismatch before clock validation", () => {
    expect(() => assertActiveRuntimeExerciseIdentity(
      [{ exerciseId: "EX-A" }],
      "EX-B",
    )).toThrow("RUNTIME_CHECKPOINT_EXERCISE_MISMATCH");
  });

  test("RB2-A1/A2 registers a persisted Runtime for every fresh package patient before envelope capture", () => {
    const exerciseId = "EX-RB2-IMAGING";
    exercisePackageLoader.bind(exerciseId, DEFAULT_EXERCISE_PACKAGE);
    installPatientMaterialization(createPatientMaterializationPlan(
      exerciseId,
      DEFAULT_EXERCISE_PACKAGE,
      packagePatientDatasetRegistry,
    ));

    prepareActiveClinicalReferenceRuntime(exerciseId);
    const captured = captureActiveClinicalReferenceRuntimes(0, exerciseId);

    expect(captured).toHaveLength(12);
    expect(captured.map(item => item.provenance.patientId)).toEqual([
      "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12",
    ]);
    expect(captured.every(item => item.provenance.exerciseId === exerciseId)).toBe(true);
    expect(captured.every(item => item.provenance.packageId === DEFAULT_EXERCISE_PACKAGE.packageId)).toBe(true);
  });

  test("RB2-A7/A8 gives packages with and without Imaging identical fresh Runtime durability semantics", () => {
    const cases = [
      ["EX-RB2-IMAGING", DEFAULT_EXERCISE_PACKAGE],
      ["EX-RB2-NO-IMAGING", HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1],
    ] as const;

    for (const [exerciseId, pkg] of cases) {
      clearActiveClinicalReferenceRuntime();
      exercisePackageLoader.bind(exerciseId, pkg);
      installPatientMaterialization(createPatientMaterializationPlan(exerciseId, pkg, packagePatientDatasetRegistry));
      prepareActiveClinicalReferenceRuntime(exerciseId);
      expect(captureActiveClinicalReferenceRuntimes(0, exerciseId)).toHaveLength(
        packagePatientDatasetRegistry.resolve(pkg.patientDatasetId).patients.length,
      );
    }
  });

  test("RB2-A9 baseline Runtime identity and seed are deterministic across reconnect", () => {
    const first = createCanonicalBaselineRuntimeFixture("P09");
    const second = createCanonicalBaselineRuntimeFixture("P09");
    expect(second).toEqual(first);
    expect(first.patientId).toBe("P09");
    expect(first.initialState).toMatchObject({ reserveLossPerMin: 0, co2GainPerMin: 0 });
  });

  test("RB2-A9 repeated fresh registration reuses one canonical Runtime set", () => {
    const exerciseId = "EX-RB2-IMAGING";
    exercisePackageLoader.bind(exerciseId, DEFAULT_EXERCISE_PACKAGE);
    installPatientMaterialization(createPatientMaterializationPlan(exerciseId, DEFAULT_EXERCISE_PACKAGE, packagePatientDatasetRegistry));
    prepareActiveClinicalReferenceRuntime(exerciseId);
    const first = captureActiveClinicalReferenceRuntimes(0, exerciseId);
    prepareActiveClinicalReferenceRuntime(exerciseId);
    const second = captureActiveClinicalReferenceRuntimes(0, exerciseId);
    expect(second).toEqual(first);
  });

  test("RB2-A2 envelope eligibility distinguishes missing Runtime from missing writer authority", () => {
    expect(checkpointEnvelopePreparationDecision(0, true)).toEqual({ eligible: false, reason: "NO_CANONICAL_RUNTIME" });
    expect(checkpointEnvelopePreparationDecision(1, false)).toEqual({ eligible: false, reason: "RUNTIME_WRITES_NOT_ALLOWED" });
    expect(checkpointEnvelopePreparationDecision(1, true)).toEqual({ eligible: true, reason: "READY" });
  });
});
