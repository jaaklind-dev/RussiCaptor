import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { resetExercise } from "@/services/ExerciseResetService";
import { createSharedExerciseSnapshot, restoreSharedExerciseState } from "@/services/StatePersistenceService";
import { validateImagingAssetReference, resolveImagingAsset } from "@/services/imaging/ImagingAssetRegistry";
import { ImagingWorkflowRuntime } from "@/services/runtime/imaging/ImagingWorkflowRuntime";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE } from "../NarvaExercisePackages";
import { calculateExercisePackageHash } from "../ExercisePackageHash";
import { exercisePackageRegistry, exercisePackageValidator, exercisePackageLoader } from "../ExercisePackageService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { createPatientMaterializationPlan, installPatientMaterialization } from "../PackagePatientMaterializationService";
import { installPackageImagingDefinitions } from "../PackageImagingInstallationService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V106 as candidate,
  NARVA_TRAUMA_IMAGING_V106_CONFIGURATION as imaging,
  NARVA_TRAUMA_IMAGING_V106_REPORTS as reports } from "../NarvaTraumaImagingV106";

const root = resolve(__dirname, "../../../..");
const expectedHashes: Record<string, string> = {
  "PT-CHEST-001": "c5a57c48190c85e8acbf067980f5741e3a895a5779ece097e6ebc259cc3ab2cd",
  "PT-PELVIC-001": "67e0866d46ae3ebee501fe7b10cdd1fff6c19a4f0886bfce646d9e5d314a5f39",
};

describe("Narva 1.0.6 explicitly authored two-patient educational Imaging", () => {
  beforeEach(resetExercise);
  afterEach(resetExercise);

  test("preserves the accepted historical 1.0.5 and IRO identities and report-only content", () => {
    const previous = exercisePackageRegistry.require("russicaptor.narva-trauma", "1.0.5");
    expect(previous.packageHash).toBe("723d6c2fc57f34c2cf681215cf1a7149e5110ca1a34d618b2391a87aff5568c6");
    expect(previous.imagingConfiguration!.definitions).toHaveLength(1);
    expect(previous.imagingConfiguration!.definitions[0].study.asset).toBeUndefined();
    expect(previous.imagingConfiguration!.definitions[0].study.report).toBe("Massiivsele hemopneumotooraksile sobiv leid.");
    expect(exercisePackageRegistry.require("russicaptor.narva-iro-evacuation", "1.0.1").packageHash)
      .toBe("da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95");
    expect(NARVA_IRO_EXERCISE_PACKAGE.imagingConfiguration).toBeUndefined();
  });

  test("registers a separate valid immutable 1.0.6 through the normal package loader", () => {
    expect(candidate.packageVersion).toBe("1.0.6");
    expect(candidate.packageHash).toBe(calculateExercisePackageHash(candidate));
    expect(Object.isFrozen(candidate.imagingConfiguration)).toBe(true);
    const loaded = exercisePackageRegistry.require(candidate.packageId, candidate.packageVersion);
    expect(exercisePackageValidator.validate(loaded)).toEqual([]);
    expect(exercisePackageRegistry.latest(candidate.packageId)).toBe(loaded);
    expect(loaded.packageHash).not.toBe(exercisePackageRegistry.require(candidate.packageId, "1.0.5").packageHash);
  });

  test("changes only the new package identity, imaging and descriptive metadata", () => {
    for (const key of Object.keys(NARVA_TRAUMA_EXERCISE_PACKAGE) as (keyof typeof candidate)[]) {
      if (["packageVersion", "imagingConfiguration", "metadata", "manifest", "packageHash"].includes(key)) continue;
      expect(candidate[key]).toEqual(NARVA_TRAUMA_EXERCISE_PACKAGE[key]);
    }
    expect(candidate.patientDatasetId).toBe("patients.narva-trauma.v3");
    expect(candidate.manifest.definitionHash).toBe(NARVA_TRAUMA_EXERCISE_PACKAGE.manifest.definitionHash);
    expect(candidate.metadata.tags).toEqual(expect.arrayContaining(NARVA_TRAUMA_EXERCISE_PACKAGE.metadata.tags));
  });

  test("owns exactly one study/order per intended Narva patient with no demo identities", () => {
    expect(imaging.definitions.map(d => [d.study.patientId, d.study.id, d.order.id])).toEqual([
      ["PT-CHEST-001", "P02-CXR", "P02-ORD-CXR"],
      ["PT-PELVIC-001", "P01-PELVIS-XR", "P01-ORD-PELVIS-XR"],
    ]);
    for (const d of imaging.definitions) {
      expect(d.study.asset).toMatchObject({ packageId: candidate.packageId, packageVersion: "1.0.6",
        patientId: d.study.patientId, definitionId: d.study.id, role: "SUPPORTING_IMAGE" });
      expect(d.study.asset.assetId).not.toMatch(/^offline-demo\./);
      expect(d.study).not.toHaveProperty("attachment");
      expect(d.order.workflow.resultTargetId).toBe(d.study.id);
    }
  });

  test.each(imaging.definitions)("validates exact bundled bytes and static resolution for $study.patientId", d => {
    const bytes = readFileSync(resolve(root, "assets/imaging", d.study.asset.resolverKey));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHashes[d.study.patientId]);
    expect(d.study.asset.sha256).toBe(expectedHashes[d.study.patientId]);
    expect(d.study.asset.byteLength).toBe(bytes.length);
    expect(() => validateImagingAssetReference(d.study.asset)).not.toThrow();
    expect(resolveImagingAsset(d.study.asset).status).toBe("RESOLVED");
    expect(d.study.asset.provenance?.attribution).toBeTruthy();
    expect(d.study.asset.provenance?.licenseId).toBeTruthy();
  });

  test("preserves the exact user-approved reports and separate image provenance", () => {
    expect(reports.chest).toBe("Leid sobib pingelise õhkrinnaga. Kaasuvad pneumomediastiinum ja roidemurrud. "
      + "Hemotooraksit ega verekaotuse suurust selle pildi põhjal ei kinnitata.");
    expect(reports.pelvis).toBe("Häbemeliidus on laienenud. Leid sobib avatud raamatu tüüpi vaagnarõnga vigastusega. "
      + "Verekaotuse suurust pildi põhjal ei hinnata.");
    expect(imaging.definitions[1].study.asset.provenance?.licenseId)
      .toBe("USER_APPROVED_GENERATED_ILLUSTRATION");
    expect(imaging.definitions[1].study.asset.provenance?.attribution)
      .toContain("ei ole pärispatsiendi uuring ega kliiniliselt valideeritud");
    expect(imaging.definitions[0].study.asset.provenance?.licenseUrl)
      .toBe("https://creativecommons.org/licenses/by-sa/3.0/");
  });

  test("rejects changed bytes, wrong patient and wrong immutable package version", () => {
    const original = imaging.definitions[0].study.asset;
    for (const changed of [{ ...original, sha256: "0".repeat(64) },
      { ...original, patientId: "PT-PELVIC-001" }, { ...original, packageVersion: "1.0.5" }]) {
      expect(() => validateImagingAssetReference(changed)).toThrow("IMAGING_ASSET_INTEGRITY_MISMATCH");
    }
    const wrongPatient = structuredClone(candidate);
    (wrongPatient.imagingConfiguration!.definitions[0].study as { patientId: string }).patientId = "PT-PELVIC-001";
    expect(exercisePackageValidator.validate(wrongPatient).some(issue => issue.code === "INVALID_IMAGING_CONFIGURATION")).toBe(true);
  });

  test("installs and restores only the two intended studies without duplicates or image binary", () => {
    const plan = createPatientMaterializationPlan("EX-NARVA-IMAGING-106", candidate, packagePatientDatasetRegistry);
    installPatientMaterialization(plan);
    installPackageImagingDefinitions(plan, candidate);
    installPackageImagingDefinitions(plan, candidate);
    expect(clinicalDataProvider.getImagingStudies()).toHaveLength(2);
    expect(clinicalDataProvider.getOrders().filter(o => o.category === "imaging")).toHaveLength(2);
    const studies = structuredClone(clinicalDataProvider.getImagingStudies());
    expect(studies.every(s => s.imageVisibility === "hidden" && s.reportVisibility === "hidden")).toBe(true);
    const snapshot = createSharedExerciseSnapshot();
    expect(JSON.stringify(snapshot)).not.toMatch(/data:image|base64|iVBORw0KGgo/);
    clinicalDataProvider.getImagingStudies().splice(0);
    restoreSharedExerciseState(snapshot, false);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(studies);
  });

  test.each(imaging.definitions)("releases $study.patientId image at 7 minutes and report at 10, once each", d => {
    const runtime = new ImagingWorkflowRuntime();
    runtime.order({ commandId: `CMD-${d.study.id}`, exerciseId: "EX-NARVA-IMAGING-106",
      patientId: d.study.patientId, orderedBy: "CM", orderedAtSimulationTimeSec: 100,
      definition: { definitionId: d.study.id, patientId: d.study.patientId, title: d.study.title,
        modality: d.study.modality, reportSource: d.study.report, asset: d.study.asset,
        delaySeconds: d.order.workflow.delayMinutes * 60, imageDelaySeconds: d.order.workflow.imageDelayMinutes * 60,
        packageId: candidate.packageId,
        packageVersion: candidate.packageVersion, packageHash: candidate.packageHash } });
    // The first advance enters PROCESSING; it must not release a result early.
    expect(runtime.advanceTo(519)).toEqual([expect.objectContaining({ status: "PROCESSING" })]);
    expect(runtime.snapshot().instances[0].result).toBeUndefined();
    expect(runtime.snapshot().instances[0].imageResult).toBeUndefined();
    const restored = new ImagingWorkflowRuntime();
    restored.restore(runtime.snapshot());
    expect(restored.advanceTo(520)).toHaveLength(1);
    const image = restored.snapshot().instances[0].imageResult;
    expect(image).toMatchObject({ asset: d.study.asset, releasedAtSimulationTimeSec: 520 });
    expect(image).not.toHaveProperty("reportText");
    expect(restored.snapshot().instances[0].result).toBeUndefined();
    expect(restored.advanceTo(699)).toEqual([]);
    expect(restored.advanceTo(700)).toHaveLength(1);
    expect(restored.snapshot().instances[0].result).toMatchObject({ reportText: d.study.report,
      asset: d.study.asset, releasedAtSimulationTimeSec: 700 });
    expect(restored.snapshot().instances[0].imageResult).toEqual(image);
    expect(restored.advanceTo(900)).toEqual([]);
    const result = restored.snapshot();
    const takeover = new ImagingWorkflowRuntime();
    takeover.restore(result);
    expect(takeover.snapshot()).toEqual(result);
    expect(takeover.advanceTo(1200)).toEqual([]);
  });

  test("validates staged timing rather than accepting missing assets or invalid deadlines", () => {
    for (const delay of [-1, NaN, Infinity, 11]) {
      const wrong = structuredClone(candidate);
      (wrong.imagingConfiguration!.definitions[0].order.workflow as { imageDelayMinutes: number }).imageDelayMinutes = delay;
      expect(exercisePackageValidator.validate(wrong).some(issue => issue.code === "INVALID_IMAGING_CONFIGURATION")).toBe(true);
    }
    const missing = structuredClone(candidate);
    delete (missing.imagingConfiguration!.definitions[0].study as { asset?: unknown }).asset;
    expect(exercisePackageValidator.validate(missing).some(issue => issue.code === "INVALID_IMAGING_CONFIGURATION")).toBe(true);
    expect(imaging.definitions.every(d => d.order.workflow.imageDelayMinutes === 7 && d.order.workflow.delayMinutes === 10)).toBe(true);
  });

  test.each(imaging.definitions)("canonical writer adapter captures both package deadlines for $study.patientId", d => {
    const exerciseId = `EX-STAGED-${d.study.id}`;
    exercisePackageLoader.bind(exerciseId, candidate);
    setRuntimeWriterAuthorityState("WRITER", "LOCAL-SYNTHETIC-LEASE");
    try {
      const record = packagePatientDatasetRegistry.resolve(candidate.patientDatasetId!).patients
        .find(p => p.patient.id === d.study.patientId)!;
      const engine = new ClinicalScenarioEngine(undefined, undefined, () => true);
      engine.reset(structuredClone(record.runtimeFixture!));
      const owner = createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, d.study.patientId);
      expect(owner.executeImagingOrder!({ commandId: `CMD-ADAPTER-${d.study.id}`, actorUserId: "CM",
        simulationTimeSec: 100, definitionId: d.study.id }).ok).toBe(true);
      expect(engine.getImagingWorkflow()).toMatchObject({ schemaVersion: 3, instances: [{
        imageAvailableAtSimulationTimeSec: 520, availableAtSimulationTimeSec: 700,
        authoredSource: { reportText: d.study.report, asset: d.study.asset } }] });
      setRuntimeWriterAuthorityState("READER");
      expect(owner.executeImagingOrder!({ commandId: "READER-DENIED", actorUserId: "CM",
        simulationTimeSec: 100, definitionId: d.study.id }).ok).toBe(false);
      expect(engine.getImagingWorkflow().instances).toHaveLength(1);
    } finally {
      setRuntimeWriterAuthorityState("UNRESOLVED"); exercisePackageLoader.unbind(exerciseId);
    }
  });
});
