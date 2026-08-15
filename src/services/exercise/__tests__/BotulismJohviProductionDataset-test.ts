import path from "node:path";
import { readSheet } from "read-excel-file/node";
import { CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE, HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1 } from "../CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { workbookSheetNames } from "@/providers/excel/WorkbookFileParser";

const oldWorkbook = path.join(process.cwd(), "outputs/russicaptor-mimino-12/Mimino_Botulism_12_Patients.xlsx");
const newWorkbook = path.join(process.cwd(), "outputs/russicaptor-botulism-johvi-v2/Botulism_Johvi_12_Patients_v2.xlsx");
const forbidden = /mimino|мимино/iu;
const text = (value: unknown): string => JSON.stringify(value);
const normalize = (value: unknown): unknown => typeof value !== "string" ? value : value
  .replaceAll("mimino-botulism", "<EXERCISE>")
  .replaceAll("botulism-johvi-v2", "<EXERCISE>")
  .replace(/LOC-(?:MIMINO|JOHVI-V2)-(TRIAGE|OBS|RED|ICU)/gu, "<LOCATION-$1>")
  .replace(/restoranis Mimino|Miminos|Jõhvi restoranis/gu, "<RESTAURANT-IN>")
  .replace(/Mimino ühise|Jõhvi restorani ühise/gu, "<RESTAURANT-GEN> ühise")
  .replace(/ühine (?:Mimino|Jõhvi restorani) söögikord/gu, "ühine <RESTAURANT-GEN> söögikord")
  .replace(/mitmel (?:Mimino külalisel|Jõhvi restorani külastajal)/gu, "mitmel <RESTAURANT-VISITOR>");

describe("WP-BOT-01 current Botulism/Jõhvi production dataset", () => {
  test("contains no old restaurant identity in production package, dataset or workbook", async () => {
    const dataset = packagePatientDatasetRegistry.resolve(DEFAULT_EXERCISE_PACKAGE.patientDatasetId);
    expect(text({ package: DEFAULT_EXERCISE_PACKAGE, dataset, workbook: path.relative(process.cwd(), newWorkbook) })).not.toMatch(forbidden);
    for (const sheet of workbookSheetNames) expect(text(await readSheet(newWorkbook, sheet, { trim: false }))).not.toMatch(forbidden);
  });

  test("materializes all 12 patients with deterministic v2 provenance", () => {
    const first = createPatientMaterializationPlan("EX-BOTULISM-JOHVI", DEFAULT_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    const second = createPatientMaterializationPlan("EX-BOTULISM-JOHVI", DEFAULT_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ packageId: "russicaptor.botulism-johvi", packageVersion: "2.0.0", datasetId: "patients.botulism-johvi.v2", datasetVersion: "2" });
    expect(first.patients.map(record => record.patient.id)).toEqual(Array.from({ length: 12 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`));
  });

  test("is clinically equivalent to the historical workbook apart from versioned identity and restaurant wording", async () => {
    let relationshipBindings = 0;
    for (const sheet of workbookSheetNames) {
      const oldRows = await readSheet(oldWorkbook, sheet, { trim: false }) as unknown[][];
      const newRows = await readSheet(newWorkbook, sheet, { trim: false }) as unknown[][];
      expect(newRows.map(row => row.map(normalize))).toEqual(oldRows.map(row => row.map(normalize)));
      relationshipBindings += newRows.flat().filter(value => value === "botulism-johvi-v2").length;
    }
    expect(relationshipBindings).toBe(182);
    expect(DEFAULT_EXERCISE_PACKAGE.enabledPatientProcesses).toEqual(HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1.enabledPatientProcesses);
  });

  test("keeps the historical v1 package outside the current production catalog", () => {
    expect(DEFAULT_EXERCISE_PACKAGE.packageId).not.toBe(HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1.packageId);
    expect(DEFAULT_EXERCISE_PACKAGE.packageVersion).toBe("2.0.0");
    expect(CANONICAL_EXERCISE_PACKAGES).not.toContainEqual(HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1);
  });
});
