import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ImagingTab from "@/components/patient/ImagingTab";
import ImageViewer from "@/components/viewers/ImageViewer";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { resetExercise } from "@/services/ExerciseResetService";
import { createSharedExerciseSnapshot, restoreSharedExerciseState } from "@/services/StatePersistenceService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { resolveImagingAsset, validateImagingAssetReference } from "@/services/imaging/ImagingAssetRegistry";
import { ImagingWorkflowRuntime } from "@/services/runtime/imaging/ImagingWorkflowRuntime";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { calculateExercisePackageHash } from "../ExercisePackageHash";
import { exercisePackageLoader, exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";
import { createPatientMaterializationPlan, installPatientMaterialization } from "../PackagePatientMaterializationService";
import { installPackageImagingDefinitions } from "../PackageImagingInstallationService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V106 as previousSource } from "../NarvaTraumaImagingV106";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V107 as candidateSource,
  NARVA_TRAUMA_IMAGING_V107_CONFIGURATION as imaging,
  NARVA_TRAUMA_IMAGING_V107_NORMAL_REPORTS as reports } from "../NarvaTraumaImagingV107";

const root = resolve(__dirname, "../../../..");
// The normal loader composes the same clinical modules for both immutable versions.
const previous = exercisePackageRegistry.require(previousSource.packageId, previousSource.packageVersion);
const candidate = exercisePackageRegistry.require(candidateSource.packageId, candidateSource.packageVersion);
const optional = imaging.definitions.slice(2);
const expectedAssets: Record<string, string> = {
  "P02-CXR": "c5a57c48190c85e8acbf067980f5741e3a895a5779ece097e6ebc259cc3ab2cd",
  "P01-PELVIS-XR": "67e0866d46ae3ebee501fe7b10cdd1fff6c19a4f0886bfce646d9e5d314a5f39",
  "P01-CXR": "4cbbcf805291db949e4ff085ca3c7258b2823de21b2857ae684e6c91ff9a38a4",
  "P02-PELVIS-XR": "ab363a11fea4a759f0f6457d4d139d92913044eff5481e9d3b1004d9bf7b8e34",
};
function orderedRuntime(d: typeof imaging.definitions[number]) {
  const runtime = new ImagingWorkflowRuntime();
  runtime.order({ commandId: `CMD-${d.study.id}`, exerciseId: "EX-107", patientId: d.study.patientId,
    orderedBy: "CM", orderedAtSimulationTimeSec: 100,
    definition: { definitionId: d.study.id, patientId: d.study.patientId, title: d.study.title,
      modality: d.study.modality, reportSource: d.study.report, asset: d.study.asset,
      delaySeconds: d.order.workflow.delayMinutes * 60,
      imageDelaySeconds: d.order.workflow.imageDelayMinutes! * 60,
      packageId: candidate.packageId, packageVersion: candidate.packageVersion, packageHash: candidate.packageHash } });
  return runtime;
}

describe("Narva 1.0.7 optional normal radiographs through the existing workflow", () => {
  beforeEach(resetExercise);
  afterEach(resetExercise);

  test("freezes a separate valid latest version without changing historical hashes or bindings", () => {
    expect(candidateSource.packageHash).toBe("760b352683a7ff9ce6cc2c11237c6b348ea8e2cfca4125a21663b5cf3c586946");
    expect(candidate.imagingConfiguration).toEqual(candidateSource.imagingConfiguration);
    expect(candidate.packageHash).toBe("64468d8ae2dcfbd8c54b4411bf1add55a8ff8b96ca6465bfee08dcebfe1cfc7e");
    expect(candidate.packageHash).toBe(calculateExercisePackageHash(candidate));
    expect(exercisePackageValidator.validate(candidate)).toEqual([]);
    expect(exercisePackageRegistry.latest(candidate.packageId)).toBe(candidate);
    expect(Object.isFrozen(candidate.imagingConfiguration!.definitions)).toBe(true);
    expect(previous.packageHash).toBe("3cf0063a0c898e9947947baee277d313ae1f32067b52f27d92b9da5945dcc58f");
    expect(exercisePackageRegistry.require(candidate.packageId, "1.0.5").packageHash)
      .toBe("723d6c2fc57f34c2cf681215cf1a7149e5110ca1a34d618b2391a87aff5568c6");
    expect(exercisePackageRegistry.require("russicaptor.narva-iro-evacuation", "1.0.1").packageHash)
      .toBe("da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95");
    exercisePackageLoader.bind("EX-EXISTING-106", previous);
    expect(exercisePackageLoader.getBound("EX-EXISTING-106")).toBe(previous);
    exercisePackageLoader.unbind("EX-EXISTING-106");
  });

  test("changes only new version, imaging and descriptive metadata", () => {
    for (const key of Object.keys(previous) as (keyof typeof candidate)[]) {
      if (["packageVersion", "imagingConfiguration", "metadata", "manifest", "packageHash"].includes(key)) continue;
      expect(candidate[key]).toEqual(previous[key]);
    }
    expect(candidate.patientDatasetId).toBe("patients.narva-trauma.v3");
    expect(candidate.manifest.definitionHash).toBe(previous.manifest.definitionHash);
  });

  test("retains pathological study/order identities, reports, timing and exact image bytes/provenance", () => {
    previous.imagingConfiguration!.definitions.forEach((old, index) => {
      const retained = imaging.definitions[index];
      const { asset: oldAsset, ...oldStudy } = old.study;
      const { asset: newAsset, ...newStudy } = retained.study;
      expect(newStudy).toEqual(oldStudy);
      expect(retained.order).toEqual(old.order);
      expect(newAsset).toMatchObject({ sha256: oldAsset!.sha256, provenance: oldAsset!.provenance,
        packageVersion: "1.0.7", patientId: old.study.patientId, definitionId: old.study.id });
      expect(newAsset!.assetId).not.toBe(oldAsset!.assetId);
      expect(readFileSync(resolve(root, "assets/imaging", newAsset!.resolverKey)))
        .toEqual(readFileSync(resolve(root, "assets/imaging", oldAsset!.resolverKey)));
    });
  });

  test("adds exactly the requested cross-region studies with unique independent orders", () => {
    expect(optional.map(d => [d.study.patientId, d.study.id, d.order.id, d.study.title])).toEqual([
      ["PT-PELVIC-001", "P01-CXR", "P01-ORD-CXR", "Rindkere röntgen"],
      ["PT-CHEST-001", "P02-PELVIS-XR", "P02-ORD-PELVIS-XR", "Vaagna röntgen"],
    ]);
    expect(new Set(imaging.definitions.map(d => d.study.id)).size).toBe(4);
    expect(new Set(imaging.definitions.map(d => d.order.id)).size).toBe(4);
    for (const d of imaging.definitions) {
      expect(d.order).toMatchObject({ status: "available", visibility: "revealed",
        workflow: { resultAction: "imaging.available", resultTargetId: d.study.id,
          imageDelayMinutes: 7, delayMinutes: 10 } });
      expect(d.study.asset).toMatchObject({ packageId: candidate.packageId, packageVersion: "1.0.7",
        patientId: d.study.patientId, definitionId: d.study.id });
    }
    expect(reports.chest).toContain("PA-rindkere");
    expect(reports.chest).not.toContain("AP-rindkere");
    expect(optional[0].study.report).toBe(reports.chest);
    expect(optional[1].study.report).toBe(reports.pelvis);
  });

  test.each(imaging.definitions)("resolves exact unchanged registered image bytes for $study.id", d => {
    const bytes = readFileSync(resolve(root, "assets/imaging", d.study.asset!.resolverKey));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedAssets[d.study.id]);
    expect(d.study.asset!.sha256).toBe(expectedAssets[d.study.id]);
    expect(d.study.asset!.byteLength).toBe(bytes.length);
    expect(() => validateImagingAssetReference(d.study.asset!)).not.toThrow();
    expect(resolveImagingAsset(d.study.asset!).status).toBe("RESOLVED");
    expect(d.study.asset!.provenance?.sourceUrl).toBeTruthy();
    expect(d.study.asset!.provenance?.licenseId).toBeTruthy();
  });

  test.each(optional)("rejects wrong patient, package, definition and hash for $study.id", d => {
    for (const patch of [{ patientId: "OTHER" }, { packageVersion: "1.0.6" },
      { definitionId: "OTHER" }, { sha256: "0".repeat(64) }]) {
      expect(() => validateImagingAssetReference({ ...d.study.asset!, ...patch }))
        .toThrow("IMAGING_ASSET_INTEGRITY_MISMATCH");
    }
  });

  test("installs four available orders without auto-ordering and restores the same package-owned studies", () => {
    const plan = createPatientMaterializationPlan("EX-107", candidate, packagePatientDatasetRegistry);
    installPatientMaterialization(plan);
    installPackageImagingDefinitions(plan, candidate);
    installPackageImagingDefinitions(plan, candidate);
    const studies = structuredClone(clinicalDataProvider.getImagingStudies());
    expect(studies).toHaveLength(4);
    expect(studies.every(s => s.imageVisibility === "hidden" && s.reportVisibility === "hidden")).toBe(true);
    const orders = clinicalDataProvider.getOrders().filter(o => o.category === "imaging");
    expect(orders).toHaveLength(4);
    expect(orders.every(o => o.status === "available")).toBe(true);
    expect(new ImagingWorkflowRuntime().snapshot().instances).toEqual([]);
    const saved = createSharedExerciseSnapshot();
    expect(JSON.stringify(saved)).not.toMatch(/data:image|base64|iVBORw0KGgo/);
    clinicalDataProvider.getImagingStudies().splice(0);
    restoreSharedExerciseState(saved, false);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(studies);
  });

  test.each(imaging.definitions)("releases $study.id at 7/10 minutes and restores both stages exactly once", d => {
    const runtime = orderedRuntime(d);
    runtime.advanceTo(519);
    expect(runtime.snapshot().instances[0].imageResult).toBeUndefined();
    expect(runtime.snapshot().instances[0].result).toBeUndefined();
    const restored = new ImagingWorkflowRuntime(); restored.restore(runtime.snapshot());
    expect(restored.advanceTo(520)).toHaveLength(1);
    const image = restored.snapshot().instances[0].imageResult;
    expect(image).toMatchObject({ asset: d.study.asset, patientId: d.study.patientId,
      definitionId: d.study.id, releasedAtSimulationTimeSec: 520 });
    expect(image).not.toHaveProperty("reportText");
    expect(restored.snapshot().instances[0].result).toBeUndefined();
    const takeover = new ImagingWorkflowRuntime(); takeover.restore(restored.snapshot());
    expect(takeover.advanceTo(699)).toEqual([]);
    expect(takeover.advanceTo(700)).toHaveLength(1);
    expect(takeover.snapshot().instances[0].result).toMatchObject({ reportText: d.study.report,
      asset: d.study.asset, patientId: d.study.patientId, definitionId: d.study.id,
      packageVersion: "1.0.7", packageHash: candidate.packageHash, releasedAtSimulationTimeSec: 700 });
    expect(takeover.snapshot().instances[0].imageResult).toEqual(image);
    const reader = new ImagingWorkflowRuntime(() => false); reader.restore(takeover.snapshot());
    expect(reader.advanceTo(900)).toEqual([]);
    expect(reader.snapshot()).toEqual(takeover.snapshot());
    expect(takeover.advanceTo(1200)).toEqual([]);
  });

  test.each(optional)("existing writer adapter orders only requested $study.id and rejects wrong patient/reader", d => {
    const exerciseId = `EX-107-${d.study.id}`;
    exercisePackageLoader.bind(exerciseId, candidate);
    setRuntimeWriterAuthorityState("WRITER", "LOCAL-SYNTHETIC-LEASE");
    try {
      const record = packagePatientDatasetRegistry.resolve(candidate.patientDatasetId!).patients
        .find(p => p.patient.id === d.study.patientId)!;
      const engine = new ClinicalScenarioEngine(undefined, undefined, () => true);
      engine.reset(structuredClone(record.runtimeFixture!));
      expect(engine.getImagingWorkflow().instances).toHaveLength(0);
      const owner = createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, d.study.patientId);
      const input = { commandId: `CMD-107-${d.study.id}`, actorUserId: "CM", simulationTimeSec: 100,
        definitionId: d.study.id };
      expect(owner.executeImagingOrder!(input).ok).toBe(true);
      expect(owner.executeImagingOrder!(input).ok).toBe(true);
      expect(engine.getImagingWorkflow()).toMatchObject({ schemaVersion: 3, instances: [{
        definitionId: d.study.id, patientId: d.study.patientId, imageAvailableAtSimulationTimeSec: 520,
        availableAtSimulationTimeSec: 700, authoredSource: { reportText: d.study.report, asset: d.study.asset } }] });
      expect(engine.getImagingWorkflow().instances).toHaveLength(1);
      const other = optional.find(o => o.study.patientId !== d.study.patientId)!;
      expect(owner.executeImagingOrder!({ ...input, commandId: "WRONG-PATIENT", definitionId: other.study.id }))
        .toMatchObject({ ok: false, reason: "IMAGING_DEFINITION_SCOPE_DENIED" });
      setRuntimeWriterAuthorityState("READER");
      expect(owner.executeImagingOrder!({ ...input, commandId: "READER-DENIED" }).ok).toBe(false);
      expect(engine.getImagingWorkflow().instances).toHaveLength(1);
    } finally {
      setRuntimeWriterAuthorityState("UNRESOLVED"); exercisePackageLoader.unbind(exerciseId);
    }
  });

  test.each(optional)("existing viewer shows $study.id image at seven and normal report only at ten", async d => {
    const runtime = orderedRuntime(d);
    const study = { ...d.study, exerciseId: "EX-107" };
    let renderer!: TestRenderer.ReactTestRenderer;
    const props = { studies: [study], onOpenImage: jest.fn(), onOpenReport: jest.fn(), readOnly: true };
    runtime.advanceTo(519);
    await act(async () => { renderer = TestRenderer.create(React.createElement(ImagingTab,
      { ...props, workflow: runtime.snapshot() })); });
    const text = () => renderer.root.findAllByType("Text" as never).map(n => n.props.children).join(" ");
    try {
      expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(0);
      expect(text()).not.toContain(d.study.report);
      runtime.advanceTo(520);
      await act(async () => renderer.update(React.createElement(ImagingTab, { ...props, workflow: runtime.snapshot() })));
      expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(1);
      expect(text()).toContain("Pilt olemas, kirjeldus ootel");
      expect(text()).not.toContain(d.study.report);
      runtime.advanceTo(699);
      await act(async () => renderer.update(React.createElement(ImagingTab, { ...props, workflow: runtime.snapshot() })));
      expect(text()).not.toContain(d.study.report);
      runtime.advanceTo(700);
      await act(async () => renderer.update(React.createElement(ImagingTab, { ...props, workflow: runtime.snapshot() })));
      expect(renderer.root.findAllByType(ImageViewer)).toHaveLength(1);
      expect(text()).toContain(d.study.report);
      expect(text()).not.toContain("kirjeldus ootel");
    } finally { await act(async () => renderer.unmount()); }
  });
});
