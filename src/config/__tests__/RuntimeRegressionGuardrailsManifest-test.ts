import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type GuardrailManifest = Readonly<{
  schemaVersion: number;
  document: string;
  runner: string;
  guardrails: readonly Readonly<{ id: string; name: string; tests: readonly string[] }>[];
  cmReaderWorkflowHeadGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  checkpointConflictGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  imagingGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  imagingAssetIngestGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  imagingAuthoringGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  procedureGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  questionGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  sourceFidelityGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  transportGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  patientCompletionGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  laboratoryGuardrails: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    phase: "FOUNDATION";
    tests: readonly string[];
  }>[];
  laboratoryContract: Readonly<{
    resultTimingsMinutesFromSample: Readonly<Record<string, number>>;
    packageScope: Readonly<{
      emoTrauma: Readonly<{ include: readonly string[]; exclude: readonly string[] }>;
      iro: Readonly<{ include: readonly string[] }>;
    }>;
    futureWorkPackageStatement: string;
  }>;
  groups: Readonly<Record<string, readonly string[]>>;
  historicalFailures: readonly Readonly<{
    id: string;
    failure: string;
    invariant: string;
    tests: readonly string[];
    physicalGate: string;
  }>[];
}>;

const root = resolve(__dirname, "../../..");
const manifestPath = resolve(root, "test/runtime-regression-guardrails.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GuardrailManifest;
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const alphabet = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

describe("RussiCaptor Runtime Regression Guardrails manifest", () => {
  test("keeps the complete A-Z guardrail catalog and all historical blockers mapped", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.guardrails.map(guardrail => guardrail.id)).toEqual(alphabet);
    expect(manifest.guardrails.every(guardrail => guardrail.name.length > 0 && guardrail.tests.length > 0)).toBe(true);
    expect(manifest.cmReaderWorkflowHeadGuardrails.map(guardrail => guardrail.id))
      .toEqual(Array.from({ length: 12 }, (_, index) => `CM-HEAD-G${String(index + 1).padStart(2, "0")}`));
    expect(manifest.cmReaderWorkflowHeadGuardrails.every(guardrail => guardrail.phase === "FOUNDATION" &&
      guardrail.name.length > 0 && guardrail.description.length > 0 && guardrail.tests.length > 0)).toBe(true);
    expect(manifest.checkpointConflictGuardrails.map(guardrail => guardrail.id))
      .toEqual(Array.from({ length: 12 }, (_, index) => `CHK-G${String(index + 1).padStart(2, "0")}`));
    expect(manifest.checkpointConflictGuardrails.every(guardrail => guardrail.phase === "FOUNDATION" &&
      guardrail.name.length > 0 && guardrail.description.length > 0 && guardrail.tests.length > 0)).toBe(true);
    expect(manifest.historicalFailures.map(failure => failure.id))
      .toEqual(Array.from({ length: 19 }, (_, index) => `H${String(index + 1).padStart(2, "0")}`));
    expect(manifest.historicalFailures.every(failure => failure.invariant.length > 0 &&
      failure.tests.length > 0 && failure.physicalGate.length > 0)).toBe(true);
  });

  test("fails when a canonical document, runner or executable regression disappears", () => {
    const referencedPaths = new Set([
      manifest.document,
      manifest.runner,
      ...manifest.guardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.cmReaderWorkflowHeadGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.checkpointConflictGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.imagingGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.imagingAssetIngestGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.imagingAuthoringGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.transportGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.patientCompletionGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.procedureGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.questionGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.sourceFidelityGuardrails.flatMap(guardrail => guardrail.tests),
      ...manifest.laboratoryGuardrails.flatMap(guardrail => guardrail.tests),
      ...Object.values(manifest.groups).flat(),
      ...manifest.historicalFailures.flatMap(failure => failure.tests),
    ]);
    expect([...referencedPaths].filter(file => !existsSync(resolve(root, file)))).toEqual([]);
  });

  test("exposes stable grouped commands through the manifest-backed runner", () => {
    expect(Object.keys(manifest.groups).sort()).toEqual(["imaging", "laboratory", "multi-device", "patient-completion", "persistence", "procedure", "questions", "runtime", "source-fidelity", "transport"]);
    expect(Object.values(manifest.groups).every(files => files.length > 0)).toBe(true);
    expect(packageJson.scripts).toMatchObject({
      "test:guardrails": "node scripts/run-runtime-guardrails.mjs all",
      "test:runtime-guardrails": "node scripts/run-runtime-guardrails.mjs runtime",
      "test:multi-device-guardrails": "node scripts/run-runtime-guardrails.mjs multi-device",
      "test:persistence-guardrails": "node scripts/run-runtime-guardrails.mjs persistence",
      "test:lab-guardrails": "node scripts/run-runtime-guardrails.mjs laboratory",
      "test:imaging-guardrails": "node scripts/run-runtime-guardrails.mjs imaging",
      "test:procedure-guardrails": "node scripts/run-runtime-guardrails.mjs procedure",
      "test:transport-guardrails": "node scripts/run-runtime-guardrails.mjs transport",
      "test:patient-completion-guardrails": "node scripts/run-runtime-guardrails.mjs patient-completion",
      "test:question-guardrails": "node scripts/run-runtime-guardrails.mjs questions",
      "test:source-fidelity-guardrails": "node scripts/run-runtime-guardrails.mjs source-fidelity",
      "narva:source-fidelity": "node scripts/narva-source-fidelity.mjs",
    });
  });

  test("keeps the mandatory policy, checklist, impact matrix and frozen IRO hashes repository-visible", () => {
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    expect(document).toContain("All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates");
    expect(document).toContain("## Mandatory feature checklist");
    expect(document).toContain("## Feature impact classification");
    expect(document).toContain("## Historical blocker mapping");
    expect(document).toContain("da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95");
    expect(document).toContain("6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0");
  });

  test("keeps the complete laboratory contract catalog unique and explicit", () => {
    const expectedLabIds = Array.from({ length: 46 }, (_, index) => `LAB-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.laboratoryGuardrails.map(guardrail => guardrail.id)).toEqual(expectedLabIds);
    expect(manifest.laboratoryGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const allIds = [...manifest.guardrails.map(guardrail => guardrail.id),
      ...manifest.historicalFailures.map(failure => failure.id),
      ...manifest.imagingGuardrails.map(guardrail => guardrail.id),
      ...manifest.sourceFidelityGuardrails.map(guardrail => guardrail.id), ...expectedLabIds];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test("keeps the complete package-owned Imaging guardrail catalog unique and explicit", () => {
    const expectedImagingIds = Array.from({ length: 45 }, (_, index) => `IMG-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.imagingGuardrails.map(guardrail => guardrail.id)).toEqual(expectedImagingIds);
    expect(manifest.imagingGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.imagingGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete Imaging asset-ingest guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 16 }, (_, index) =>
      `IMG-ASSET-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.imagingAssetIngestGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.imagingAssetIngestGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const allIds = [...manifest.imagingGuardrails.map(guardrail => guardrail.id), ...expectedIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.imagingAssetIngestGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete Imaging authoring guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 16 }, (_, index) =>
      `IMG-AUTH-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.imagingAuthoringGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.imagingAuthoringGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const allIds = [...manifest.imagingGuardrails.map(guardrail => guardrail.id),
      ...manifest.imagingAssetIngestGuardrails.map(guardrail => guardrail.id), ...expectedIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.imagingAuthoringGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete procedure availability guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 42 }, (_, index) => `PROC-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.procedureGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.procedureGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.procedureGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete transport hardening guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 24 }, (_, index) => `TRANS-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.transportGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.transportGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.transportGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete package-owned question guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 10 }, (_, index) => `Q-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.questionGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.questionGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.questionGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete Narva source-fidelity guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 30 }, (_, index) => `SRC-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.sourceFidelityGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.sourceFidelityGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.sourceFidelityGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("keeps the complete durable patient-completion guardrail catalog unique and explicit", () => {
    const expectedIds = Array.from({ length: 24 }, (_, index) => `PATCOMP-G${String(index + 1).padStart(2, "0")}`);
    expect(manifest.patientCompletionGuardrails.map(guardrail => guardrail.id)).toEqual(expectedIds);
    expect(manifest.patientCompletionGuardrails.every(guardrail => guardrail.name.length > 0 &&
      guardrail.description.length > 0 && guardrail.phase === "FOUNDATION" && guardrail.tests.length > 0)).toBe(true);
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.patientCompletionGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
  });

  test("freezes Narva laboratory timing, package scope and future-WP policy", () => {
    expect(manifest.laboratoryContract.resultTimingsMinutesFromSample).toEqual({
      Astrup: 25,
      Hematology: 30,
      AB0_RhD_AntibodyScreen: 30,
      ClinicalChemistry: 40,
      Coagulation: 40,
    });
    expect(manifest.laboratoryContract.packageScope).toEqual({
      emoTrauma: { include: ["POLÜTRAUMA"], exclude: ["SARS-CoV-2", "influenza", "urine analyses", "U-Narco"] },
      iro: { include: ["Astrup"] },
    });
    expect(manifest.laboratoryContract.futureWorkPackageStatement).toBe(
      "All RussiCaptor Runtime Regression Guardrails, including Laboratory Regression Guardrails LAB-G01 through LAB-G46, are mandatory acceptance gates for this work package. Determine impacted guardrail classes before implementation. No guardrail may be weakened, bypassed, deleted, or threshold-relaxed.",
    );
    const document = readFileSync(resolve(root, manifest.document), "utf8");
    for (const guardrail of manifest.laboratoryGuardrails) expect(document).toContain(`| ${guardrail.id} |`);
    expect(document).toContain(manifest.laboratoryContract.futureWorkPackageStatement);
  });
});
