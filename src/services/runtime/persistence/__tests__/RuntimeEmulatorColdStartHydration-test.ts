import type { MaterializedPatientDataset } from "@/models/exercise/PackagePatientDataset";
import type { PersistedRuntimeState } from "@/models/PersistedRuntimeState";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import {
  createPatientMaterializationPlan,
  installPatientMaterialization,
  restorePatientMaterialization,
} from "@/services/exercise/PackagePatientMaterializationService";
import {
  captureActiveClinicalReferenceRuntimes,
  clearActiveClinicalReferenceRuntime,
  prepareActiveClinicalReferenceRuntime,
  prepareActiveClinicalReferenceRuntimeAsync,
} from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import { canonicalRuntimePersistenceService } from "../CanonicalRuntimePersistenceService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const exerciseId = "EX-EMULATOR-COLD-START";

function events(artifact: PersistedRuntimeState, count: number): PersistedRuntimeState {
  const patientId = artifact.provenance.patientId;
  const payload = {
    ...structuredClone(artifact.payload),
    sequence: count,
    eventLog: Array.from({ length: count }, (_, index) => ({
      eventType: "COLD_START_FIXTURE",
      sourceModule: "TEST",
      target: patientId,
      simulationTime: 0,
      enginePhase: 1,
      sequence: index + 1,
      payload: { index, patientId },
    })),
  };
  return { ...structuredClone(artifact), payload, payloadHash: sha256Text(stableJson(payload)) };
}

function planWithChestStatus(status: "Active" | "Completed"): MaterializedPatientDataset {
  const plan = createPatientMaterializationPlan(
    exerciseId,
    NARVA_TRAUMA_EXERCISE_PACKAGE,
    packagePatientDatasetRegistry,
  );
  return {
    ...structuredClone(plan),
    patients: plan.patients.map(record => record.patient.id === "PT-CHEST-001"
      ? { ...structuredClone(record), patient: { ...record.patient, status } }
      : structuredClone(record)),
  } as MaterializedPatientDataset;
}

async function restoreTwoPatients(status: "Active" | "Completed", eventCounts: readonly [number, number]): Promise<void> {
  installPatientMaterialization(planWithChestStatus(status));
  exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
  prepareActiveClinicalReferenceRuntime(exerciseId);
  const fresh = captureActiveClinicalReferenceRuntimes(0, exerciseId);
  const large = fresh.map((artifact, index) => events(artifact, eventCounts[index]));
  clearActiveClinicalReferenceRuntime();

  await prepareActiveClinicalReferenceRuntimeAsync(exerciseId, large, async () => Promise.resolve());
  expect(captureActiveClinicalReferenceRuntimes(0, exerciseId).map(item => ({
    patientId: item.provenance.patientId,
    eventCount: item.payload.eventLog.length,
  }))).toEqual([
    { patientId: "PT-CHEST-001", eventCount: eventCounts[0] },
    { patientId: "PT-PELVIC-001", eventCount: eventCounts[1] },
  ]);
}

describe("Android emulator cold-start Runtime hydration", () => {
  afterEach(() => {
    clearActiveClinicalReferenceRuntime();
    restorePatientMaterialization();
    exercisePackageLoader.unbind(exerciseId);
  });

  test("one large patient artifact restores cooperatively", async () => {
    installPatientMaterialization(planWithChestStatus("Completed"));
    exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    prepareActiveClinicalReferenceRuntime(exerciseId);
    const artifact = events(captureActiveClinicalReferenceRuntimes(0, exerciseId)[0], 3_644);
    const engine = new ClinicalScenarioEngine();

    await canonicalRuntimePersistenceService.rehydrateAsync(
      engine,
      artifact,
      artifact.provenance,
      async () => Promise.resolve(),
    );

    expect(engine.getEventLog()).toHaveLength(3_644);
    expect(engine.getAssessmentPublicationDiagnostics()).toMatchObject({ publishedGeneration: 1, publicationCount: 1 });
  });

  test("two active patient artifacts restore in deterministic package order", async () => {
    await restoreTwoPatients("Active", [3_644, 1_220]);
  });

  test("completed plus active patient artifacts restore and repeat without duplicates", async () => {
    await restoreTwoPatients("Completed", [3_644, 1_220]);
    const first = captureActiveClinicalReferenceRuntimes(0, exerciseId);
    clearActiveClinicalReferenceRuntime();
    await prepareActiveClinicalReferenceRuntimeAsync(exerciseId, first, async () => Promise.resolve());
    expect(captureActiveClinicalReferenceRuntimes(0, exerciseId)).toEqual(first);
  });

  test("completed plus active restore is independent of evidence volume", async () => {
    await restoreTwoPatients("Completed", [64, 32]);
  });
});
