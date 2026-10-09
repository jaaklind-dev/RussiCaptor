import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import type { ExerciseBuilderDraft } from "@/models/builder/ExerciseBuilderDraft";
import { compileBuilderDraft, newBuilderDraft, serializeBuilderSourceBundle, validateBuilderDraft } from
  "../ExerciseBuilderService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { PackagePatientDatasetRegistry, createPatientMaterializationPlan } from
  "@/services/exercise/PackagePatientMaterializationService";

const complete = (): ExerciseBuilderDraft => ({ ...newBuilderDraft(), packageId: "russicaptor.builder-test",
  packageVersion: "1.0.0", name: "Builder test", description: "Two patient exercise", author: "Test author",
  patients: [{ id: "PT-A", name: "Patsient A", triage: "P1", location: "ED", handover: "Trauma",
    vitals: { hr: 122, sbp: 88, dbp: 56, rr: 28, spo2: 90, temperature: 36.1, gcs: 14 },
    labs: { LAB_CRP: 42, LAB_CREATININE: 80 } },
  { id: "PT-B", name: "Patsient B", triage: "P2", location: "ED", handover: "Observation",
    vitals: { hr: 88, sbp: 112, dbp: 70, rr: 17, spo2: 98 }, labs: {} }],
  studies: [{ id: "IMG-A", patientId: "PT-A", modality: "XR", title: "Rindkere röntgen",
    report: "Leid", resultDelaySeconds: 420 }],
  labResultDelaySeconds: { CLINICAL_CHEMISTRY: 2400 },
});

describe("Exercise Builder v1 package contract", () => {
  test("creates an empty editable draft and rejects incomplete source", () => {
    expect(newBuilderDraft().patients).toEqual([]);
    expect(validateBuilderDraft(newBuilderDraft()).some(item => item.level === "ERROR")).toBe(true);
  });
  test("compiles patients, baseline vitals, static labs, report-only imaging and simulation delay", () => {
    const { exercisePackage, patientDataset } = compileBuilderDraft(complete());
    expect(patientDataset.patients).toHaveLength(2);
    expect((patientDataset.patients[0].runtimeFixture!.initialState as { baselineVitals: { hr: number } })
      .baselineVitals.hr).toBe(122);
    expect(exercisePackage.laboratoryConfiguration?.patients[0].initialResults.LAB_CRP).toBe(42);
    expect(exercisePackage.laboratoryConfiguration?.resultDelaySeconds?.CLINICAL_CHEMISTRY).toBe(2400);
    expect(exercisePackage.imagingConfiguration?.definitions[0].order.workflow.delayMinutes).toBe(7);
    expect(exercisePackage.imagingConfiguration?.definitions[0].study.asset).toBeUndefined();
  });
  test("same authored state has identical package and dataset hashes", () => {
    const first = compileBuilderDraft(complete());
    const second = compileBuilderDraft(structuredClone(complete()));
    expect(second.exercisePackage.packageHash).toBe(first.exercisePackage.packageHash);
    expect(second.datasetHash).toBe(first.datasetHash);
  });
  test("compiled package roundtrips through canonical patient materialization and baseline Runtime hydration", () => {
    const compiled = compileBuilderDraft(complete());
    const registry = new PackagePatientDatasetRegistry(); registry.register(compiled.patientDataset);
    const plan = createPatientMaterializationPlan("EX-BUILDER", compiled.exercisePackage, registry);
    expect(plan.patients).toHaveLength(2);
    const engine = new ClinicalScenarioEngine();
    engine.reset(plan.patients[0].runtimeFixture!);
    expect(engine.getRuntimeState().displayedVitals.hr).toBeDefined();
  });
  test("changed immutable package version is rejected until version advances", () => {
    const draft = complete();
    expect(validateBuilderDraft(draft, () => true).map(item => item.code)).toContain("IMMUTABLE_VERSION");
    expect(compileBuilderDraft({ ...draft, packageVersion: "1.0.1" }).exercisePackage.packageVersion).toBe("1.0.1");
  });
  test("catalog excludes dynamic and non-reportable entries from static authoring", () => {
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ASTRUP_HB_FR")?.reportable).toBe(false);
    const invalid = { ...complete(), patients: [{ ...complete().patients[0], labs: { LAB_ASTRUP_HB_FR: 12,
      LAB_NA: 145 } }] };
    expect(validateBuilderDraft(invalid).filter(item => item.code === "LAB")).toHaveLength(2);
  });
  test("abnormal but structurally valid vitals are permitted", () => {
    const draft = complete();
    expect(validateBuilderDraft({ ...draft, patients: [{ ...draft.patients[0], vitals: { sbp: 48 } }] }))
      .toEqual([]);
  });
  test("asset reference cannot be silently omitted from a compiled package", () => {
    const draft = complete();
    expect(() => compileBuilderDraft({ ...draft, studies: [{ ...draft.studies[0],
      image: { localUri: "file:///image.jpg", fileName: "image.jpg", source: "Local test",
        licenseId: "TEST", contributor: "Test" } }] })).toThrow("BUILDER_ASSET_NOT_COMPILED");
  });
  test("source bundle ordering is deterministic and missing image bytes are rejected", () => {
    const draft = complete();
    expect(serializeBuilderSourceBundle({ schemaVersion: 1, draft, images: [] })).toBe(
      serializeBuilderSourceBundle({ schemaVersion: 1, draft: structuredClone(draft), images: [] }));
    expect(() => serializeBuilderSourceBundle({ schemaVersion: 1, draft: { ...draft,
      studies: [{ ...draft.studies[0], image: { localUri: "file:///image.png", fileName: "image.png",
        source: "Test", licenseId: "TEST", contributor: "Test" } }] }, images: [] }))
      .toThrow("BUILDER_IMAGE_BUNDLE_MISMATCH");
  });
});
