import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NARVA_TRAUMA_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE_V101,
  NARVA_TRAUMA_EXERCISE_PACKAGE_V102 } from "../NarvaExercisePackages";
import { NARVA_CHEST_BLEEDING_RATE_ML_MIN, NARVA_CHEST_FIXTURE, NARVA_PELVIC_FIXTURE,
  NARVA_TRAUMA_MTP_CONFIGURATION, NARVA_TRAUMA_OXYGEN_PATIENT_DATASET } from "../NarvaPatientDatasets";
import { NARVA_TRAUMA_P02_IMAGING_SOURCE } from "../NarvaTraumaImagingDefinitions";
import { NARVA_TRAUMA_QUESTION_CONFIGURATION } from "../NarvaTraumaQuestionDefinitions";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("../../../../scripts/lib/narva-source-fidelity-core.cjs") as {
  evaluateFidelity: (manifest: Manifest, actual: Record<string, unknown>) => Result[];
  summarizeFidelity: (results: Result[]) => { total: number; counts: Record<string, number>; drift: Result[] };
  sha256File: (path: string) => string;
};
type Item = Readonly<{ id: string; classification: string; productionValue: unknown; rationale: string;
  resolutionGuard?: string }>;
type Manifest = Readonly<{ schemaVersion: number; classifications: readonly string[]; items: readonly Item[];
  sources: Readonly<{ originalWorkbook: Readonly<{ path: string; fileSha256: string }>;
    canonicalWorkbook: Readonly<{ path: string; fileSha256: string; semanticSha256: string;
      verificationPath: string }> }> }>;
type Result = Item & Readonly<{ drift: string | null }>;

const root = resolve(__dirname, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(root, "test/narva-source-fidelity.manifest.json"), "utf8")) as Manifest;
const transport = NARVA_TRAUMA_EXERCISE_PACKAGE.transportConfiguration!;
const availability = NARVA_TRAUMA_EXERCISE_PACKAGE.interventionAvailability!;
const pelvicState = NARVA_PELVIC_FIXTURE.initialState as Record<string, any>;
const chestState = NARVA_CHEST_FIXTURE.initialState as Record<string, any>;
const mtpInventory = NARVA_TRAUMA_MTP_CONFIGURATION.initialInventory as Record<string, any>;
const patientAvailability = (patientId: string) => availability.patients.find(item => item.patientId === patientId)!;
const questions = NARVA_TRAUMA_QUESTION_CONFIGURATION.definitions;
const actual: Record<string, unknown> = Object.fromEntries(manifest.items.map(item => [item.id, item.productionValue]));

Object.assign(actual, {
  "package.identity": { packageId: NARVA_TRAUMA_EXERCISE_PACKAGE.packageId,
    version: NARVA_TRAUMA_EXERCISE_PACKAGE.packageVersion },
  "patients.mapping": ["PT-PELVIC-001", "PT-CHEST-001"],
  "p01.baseline-vitals": pelvicState.baselineVitals,
  "p02.baseline-vitals": chestState.baselineVitals,
  "p01.start-location": NARVA_TRAUMA_OXYGEN_PATIENT_DATASET.patients
    .find(item => item.patient.id === "PT-PELVIC-001")!.patient.location,
  "p02.start-location": NARVA_TRAUMA_OXYGEN_PATIENT_DATASET.patients
    .find(item => item.patient.id === "PT-CHEST-001")!.patient.location,
  "p01.pelvic-bleeding": { baselineMlMin: pelvicState.hemorrhageSources[0]
    .configuration.baselineBleedingRateMlMin, binderEfficiency: pelvicState.hemorrhageSources[0]
      .configuration.binderEfficiency },
  "p01.binder-residual-flow": { residualMlMin: pelvicState.hemorrhageSources[0]
    .configuration.baselineBleedingRateMlMin * (1 - pelvicState.hemorrhageSources[0]
      .configuration.binderEfficiency) },
  "p02.initial-drainage": chestState.pleuralInjury.configuration.initialDrainageVolumeMl,
  "p02.continuing-bleeding": { mlPerHour: NARVA_CHEST_BLEEDING_RATE_ML_MIN * 60 },
  "p02.oxygen": { patient: "PT-CHEST-001", intervention: patientAvailability("PT-CHEST-001")
    .allowedResourceInterventionDefinitionIds.includes("OXYGEN_THERAPY") ? "OXYGEN_THERAPY" : "ABSENT" },
  "p01.pelvic-binder": patientAvailability("PT-PELVIC-001").allowedResourceInterventionDefinitionIds[0],
  "p02.pleural-drain": patientAvailability("PT-CHEST-001").allowedResourceInterventionDefinitionIds[0],
  "procedure.patient-scope": {
    "PT-PELVIC-001": patientAvailability("PT-PELVIC-001").allowedResourceInterventionDefinitionIds,
    "PT-CHEST-001": patientAvailability("PT-CHEST-001").allowedResourceInterventionDefinitionIds,
  },
  "mtp.products": { RBC: mtpInventory.RBC.mode, PLASMA: mtpInventory.PLASMA.mode,
    PLATELETS: mtpInventory.PLATELETS },
  "imaging.p02-cxr": { patient: NARVA_TRAUMA_P02_IMAGING_SOURCE.patientId,
    studyId: NARVA_TRAUMA_P02_IMAGING_SOURCE.studyId, orderId: NARVA_TRAUMA_P02_IMAGING_SOURCE.orderId,
    modality: NARVA_TRAUMA_P02_IMAGING_SOURCE.modality, title: NARVA_TRAUMA_P02_IMAGING_SOURCE.title,
    report: NARVA_TRAUMA_P02_IMAGING_SOURCE.report, delayMinutes: NARVA_TRAUMA_P02_IMAGING_SOURCE.delayMinutes },
  "questions.p01": questions.filter(item => item.sourcePatientId === "P01").map(item => item.questionId),
  "questions.p02": questions.filter(item => item.sourcePatientId === "P02").map(item => item.questionId),
  "transport.vehicle": transport.resources.length,
  "transport.ivkh": { seconds: transport.destinations.find(item => item.destinationId === "IVKH")!.travelDurationSec },
  "transport.perh": { seconds: transport.destinations.find(item => item.destinationId === "PERH")!.travelDurationSec },
  "questions.demo-isolation": questions.length,
  "imaging.asset": null,
});

describe("Narva source-fidelity guardrails SRC-G01..SRC-G12", () => {
  test("SRC-G01 verifies raw artifacts and the approved canonical semantic checksum", () => {
    expect(core.sha256File(resolve(root, manifest.sources.originalWorkbook.path)))
      .toBe(manifest.sources.originalWorkbook.fileSha256);
    expect(core.sha256File(resolve(root, manifest.sources.canonicalWorkbook.path)))
      .toBe(manifest.sources.canonicalWorkbook.fileSha256);
    expect(readFileSync(resolve(root, manifest.sources.canonicalWorkbook.verificationPath), "utf8"))
      .toContain(manifest.sources.canonicalWorkbook.semanticSha256);
    expect(NARVA_TRAUMA_P02_IMAGING_SOURCE.canonicalWorkbookChecksum)
      .toBe(manifest.sources.canonicalWorkbook.semanticSha256);
  });

  test("SRC-G02..SRC-G07 and SRC-G10 reject unexpected production drift", () => {
    const results = core.evaluateFidelity(manifest, actual);
    expect(core.summarizeFidelity(results).drift).toEqual([]);
    expect(new Set(manifest.items.map(item => item.id)).size).toBe(manifest.items.length);
    const mutated = { ...actual, "p02.oxygen": { patient: "PT-PELVIC-001", intervention: "OXYGEN_THERAPY" } };
    expect(core.evaluateFidelity(manifest, mutated).find(item => item.id === "p02.oxygen")?.drift)
      .toBe("PRODUCTION_DRIFT");
  });

  test("SRC-G08..SRC-G09 keep conflict and ambiguity unresolved rather than falsely passing", () => {
    const conflict = manifest.items.find(item => item.id === "p02.continuing-bleeding")!;
    expect(conflict).toMatchObject({ classification: "SOURCE_CONFLICT",
      productionValue: { mlPerHour: 200 }, resolutionGuard: expect.stringContaining("explicit") });
    expect(manifest.items.filter(item => ["SOURCE_CONFLICT", "SOURCE_AMBIGUOUS", "SOURCE_DEFINED_MISSING"]
      .includes(item.classification)).every(item => item.rationale.length > 0 && Boolean(item.resolutionGuard))).toBe(true);
  });

  test("SRC-G11 preserves historical packages while current source mapping remains versioned", () => {
    expect([NARVA_TRAUMA_EXERCISE_PACKAGE_V101, NARVA_TRAUMA_EXERCISE_PACKAGE_V102,
      NARVA_TRAUMA_EXERCISE_PACKAGE].map(item => item.packageVersion)).toEqual(["1.0.1", "1.0.2", "1.0.3"]);
    expect(new Set([NARVA_TRAUMA_EXERCISE_PACKAGE_V101, NARVA_TRAUMA_EXERCISE_PACKAGE_V102,
      NARVA_TRAUMA_EXERCISE_PACKAGE].map(item => item.packageHash)).size).toBe(3);
  });

  test("SRC-G12 produces deterministic privacy-safe summaries", () => {
    const first = core.summarizeFidelity(core.evaluateFidelity(manifest, actual));
    const second = core.summarizeFidelity(core.evaluateFidelity(manifest, actual));
    expect(second).toEqual(first);
    expect(first.total).toBe(manifest.items.length);
    expect(JSON.stringify(manifest)).not.toMatch(/isikukood|national.?id/iu);
  });
});
