import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { resetExercise } from "@/services/ExerciseResetService";
import { createSharedExerciseSnapshot, restoreSharedExerciseState } from "@/services/StatePersistenceService";
import { ImagingWorkflowRuntime } from "@/services/runtime/imaging/ImagingWorkflowRuntime";
import type { ImagingOrderDefinitionSnapshot } from "@/models/ImagingWorkflow";
import { DEFAULT_EXERCISE_PACKAGE } from "../CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE } from "../NarvaExercisePackages";
import {
  NARVA_TRAUMA_IMAGING_CONFIGURATION,
  NARVA_TRAUMA_P02_IMAGING_SOURCE,
} from "../NarvaTraumaImagingDefinitions";
import { installPackageImagingDefinitions } from "../PackageImagingInstallationService";
import { createPatientMaterializationPlan, installPatientMaterialization } from "../PackagePatientMaterializationService";

const installNarva = () => {
  const plan = createPatientMaterializationPlan(
    "EX-I3A",
    NARVA_TRAUMA_EXERCISE_PACKAGE,
    packagePatientDatasetRegistry,
  );
  installPatientMaterialization(plan);
  installPackageImagingDefinitions(plan, NARVA_TRAUMA_EXERCISE_PACKAGE);
  return plan;
};

const runtimeDefinition = (): ImagingOrderDefinitionSnapshot => ({
  definitionId: NARVA_TRAUMA_P02_IMAGING_SOURCE.studyId,
  patientId: NARVA_TRAUMA_P02_IMAGING_SOURCE.patientId,
  title: NARVA_TRAUMA_P02_IMAGING_SOURCE.title,
  modality: NARVA_TRAUMA_P02_IMAGING_SOURCE.modality,
  reportSource: NARVA_TRAUMA_P02_IMAGING_SOURCE.report,
  delaySeconds: NARVA_TRAUMA_P02_IMAGING_SOURCE.delayMinutes * 60,
  packageId: NARVA_TRAUMA_EXERCISE_PACKAGE.packageId,
  packageVersion: NARVA_TRAUMA_EXERCISE_PACKAGE.packageVersion,
  packageHash: NARVA_TRAUMA_EXERCISE_PACKAGE.packageHash,
});

describe("I3A approved Narva Imaging content / IMG-G26..IMG-G34", () => {
  beforeEach(resetExercise);
  afterEach(resetExercise);

  test("I3A-A1/A4 preserves the approved workbook identity, content, delay and absence of speculative fields", () => {
    expect(NARVA_TRAUMA_P02_IMAGING_SOURCE).toEqual({
      sourcePatientId: "P02",
      patientId: "PT-CHEST-001",
      studyId: "P02-CXR",
      orderId: "P02-ORD-CXR",
      modality: "XR",
      title: "Rindkere röntgen",
      report: "Massiivsele hemopneumotooraksile sobiv leid.",
      delayMinutes: 7,
      canonicalWorkbookChecksum: "d2618915e91161350783f0d1303fb4117e034e2688285e04850c339b31833231",
    });
    expect(NARVA_TRAUMA_IMAGING_CONFIGURATION.definitions).toHaveLength(1);
    expect(NARVA_TRAUMA_IMAGING_CONFIGURATION.definitions[0].study).not.toHaveProperty("attachment");
  });

  test("I3A-A2/A3/A5/A6/A7 bootstraps one chest definition, keeps pelvic and IRO empty, and leaks no demo/Botulism content", () => {
    installNarva();
    expect(clinicalDataProvider.getImagingStudies()).toEqual([expect.objectContaining({
      id: "P02-CXR", patientId: "PT-CHEST-001", modality: "XR",
      title: "Rindkere röntgen", report: "Massiivsele hemopneumotooraksile sobiv leid.",
    })]);
    expect(clinicalDataProvider.getImagingStudies().filter(item => item.patientId === "PT-PELVIC-001")).toEqual([]);
    expect(clinicalDataProvider.getImagingStudies().some(item => item.patientId === "PT-001" || /^P(?:09|11|12)$/.test(item.patientId))).toBe(false);
    expect(NARVA_IRO_EXERCISE_PACKAGE.imagingConfiguration).toBeUndefined();
    expect(DEFAULT_EXERCISE_PACKAGE.imagingConfiguration?.definitions).toHaveLength(3);
  });

  test("I3A-A8/A9 restore and repeated bootstrap preserve one deterministic definition", () => {
    const plan = installNarva();
    const original = structuredClone(clinicalDataProvider.getImagingStudies());
    installPackageImagingDefinitions(plan, NARVA_TRAUMA_EXERCISE_PACKAGE);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(original);
    const snapshot = createSharedExerciseSnapshot();
    clinicalDataProvider.getImagingStudies().splice(0);
    restoreSharedExerciseState(snapshot, false);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(original);
    expect(original.map(item => item.id)).toEqual(["P02-CXR"]);
  });

  test("I3A-A10/A11 uses I2 lifecycle, hides the report before 7 minutes, releases once, and restores pending/resulted state", () => {
    const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "CMD-I3A", exerciseId: "EX-I3A", patientId: "PT-CHEST-001",
      orderedBy: "CM", orderedAtSimulationTimeSec: 100, definition: runtimeDefinition() });
    runtime.advanceTo(519);
    expect(runtime.snapshot().instances[0]).toMatchObject({ status: "PROCESSING" });
    expect(runtime.snapshot().instances[0].result).toBeUndefined();

    const pending = new ImagingWorkflowRuntime(); pending.restore(runtime.snapshot());
    expect(pending.advanceTo(520)).toEqual([expect.objectContaining({ status: "RESULTED",
      result: expect.objectContaining({ reportText: NARVA_TRAUMA_P02_IMAGING_SOURCE.report,
        releasedAtSimulationTimeSec: 520 }) })]);
    expect(pending.advanceTo(1_000)).toEqual([]);

    const resulted = new ImagingWorkflowRuntime(); resulted.restore(pending.snapshot());
    expect(resulted.snapshot()).toEqual(pending.snapshot());
    expect(resulted.advanceTo(2_000)).toEqual([]);
  });

  test("I3A-A12 captures authored source so unrelated package mutation cannot alter the result", () => {
    const source = runtimeDefinition();
    const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: "CMD-I3A-MUT", exerciseId: "EX-I3A", patientId: "PT-CHEST-001",
      orderedBy: "CM", orderedAtSimulationTimeSec: 0, definition: source });
    (source as { reportSource: string }).reportSource = "unrelated mutation";
    runtime.advanceTo(420);
    expect(runtime.snapshot().instances[0].result?.reportText).toBe(NARVA_TRAUMA_P02_IMAGING_SOURCE.report);
  });
});
