import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readSheet } from "read-excel-file/node";

import { NARVA_CHEST_FIXTURE, NARVA_PELVIC_FIXTURE } from "../NarvaPatientDatasets";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("../../../../scripts/lib/narva-source-fidelity-core.cjs") as {
  summarizeFidelity: (items: readonly Record<string, unknown>[]) => Readonly<Record<string, unknown>>;
};

type SemanticCategory = "MATCH" | "EXPECTED_OBSERVATION" | "SOURCE_CHECKPOINT";
type VitalValues = Readonly<{ hr: number; sbp: number; dbp: number; rr: number; spo2: number;
  temperature: number; gcs: number; pain: number }>;
type VitalRow = Readonly<{ sourcePatientId: "P01" | "P02";
  productionPatientId: "PT-PELVIC-001" | "PT-CHEST-001"; vitalId: string; minute: number;
  values: VitalValues; semanticCategory: SemanticCategory; phaseHint?: string;
  productionRelationship: string; exactRuntimeTarget: boolean }>;
type FidelityItem = Readonly<{ id: string; classification: string; rationale: string;
  productionValue: unknown; vitalRow?: VitalRow }>;
type Manifest = Readonly<{ classifications: readonly string[]; items: readonly FidelityItem[];
  scriptedVitalsPolicy: Readonly<{ canonicalRuntimeAuthority: string;
    laterRowsAreExactRuntimeTargets: boolean; scriptedOverrides: boolean;
    numericToleranceModel: null; authorityDecisionRequiredForPlayback: boolean }>;
  sources: Readonly<{ canonicalWorkbook: Readonly<{ path: string }> }> }>;

const root = resolve(__dirname, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(root, "test/narva-source-fidelity.manifest.json"), "utf8")) as Manifest;
const vitalItems = manifest.items.filter((item): item is FidelityItem & { vitalRow: VitalRow } =>
  Boolean(item.vitalRow));
const byVitalId = new Map(vitalItems.map(item => [item.vitalRow.vitalId, item]));

const expectedCategories = Object.freeze({
  MATCH: Object.freeze(["P01-V0", "P02-V0"]),
  EXPECTED_OBSERVATION: Object.freeze(["P01-V10", "P01-V20", "P01-V105", "P02-V10", "P02-V20"]),
  SOURCE_CHECKPOINT: Object.freeze(["P01-V30-STAB", "P02-V50-TRANSPORT", "P02-V60-DELAY", "P02-V90-DELAY"]),
});

const productionFiles = (directory: string): string[] => readdirSync(directory).flatMap(name => {
  const path = resolve(directory, name);
  if (name === "__tests__" || name.endsWith("-test.ts") || name.endsWith("-test.tsx")) return [];
  return statSync(path).isDirectory() ? productionFiles(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
});

describe("SRC-G21..SRC-G30 Narva scripted-vitals fidelity", () => {
  test("SRC-G21 maps all eleven stable vital IDs exactly once", () => {
    expect(vitalItems).toHaveLength(11);
    expect([...byVitalId.keys()].sort()).toEqual(Object.values(expectedCategories).flat().sort());
    expect(new Set(vitalItems.map(item => item.vitalRow.vitalId)).size).toBe(11);
  });

  test("SRC-G22..SRC-G24 preserve baseline, observation and checkpoint semantics", () => {
    for (const [category, ids] of Object.entries(expectedCategories) as [SemanticCategory, readonly string[]][]) {
      expect(ids.map(id => byVitalId.get(id)?.vitalRow.semanticCategory)).toEqual(ids.map(() => category));
      expect(ids.map(id => byVitalId.get(id)?.classification)).toEqual(ids.map(() => category));
    }
    expect(vitalItems.filter(item => item.vitalRow.semanticCategory === "MATCH")).toHaveLength(2);
    expect(vitalItems.filter(item => item.vitalRow.semanticCategory === "EXPECTED_OBSERVATION")).toHaveLength(5);
    expect(vitalItems.filter(item => item.vitalRow.semanticCategory === "SOURCE_CHECKPOINT")).toHaveLength(4);
  });

  test("SRC-G25 matches every mapped value to the approved canonical workbook", async () => {
    const workbookPath = resolve(root, manifest.sources.canonicalWorkbook.path);
    const sheet = await readSheet(workbookPath, "Vitals", { trim: false }) as unknown[][];
    const headers = (sheet[0] as string[]).map(String);
    const value = (row: unknown[], column: string) => row[headers.indexOf(column)];
    const workbookRows = new Map(sheet.slice(1).map(row => [String(value(row, "VitalId")), row]));
    expect(workbookRows.size).toBe(11);
    for (const item of vitalItems) {
      const row = workbookRows.get(item.vitalRow.vitalId)!;
      expect(row).toBeDefined();
      expect({
        sourcePatientId: value(row, "PatientId"), minute: value(row, "ExerciseMinute"),
        values: { hr: value(row, "HeartRate"), sbp: value(row, "SystolicBP"),
          dbp: value(row, "DiastolicBP"), rr: value(row, "RespiratoryRate"),
          spo2: value(row, "SpO2"), temperature: value(row, "Temperature"),
          gcs: value(row, "GCS"), pain: value(row, "PainScore") },
      }).toEqual({ sourcePatientId: item.vitalRow.sourcePatientId, minute: item.vitalRow.minute,
        values: item.vitalRow.values });
      expect(value(row, "BloodGlucose")).toBeNull();
      expect(value(row, "EtCO2")).toBeNull();
    }
  });

  test("SRC-G22 keeps the two T+0 rows equal to immutable production baselines", () => {
    const pelvic = NARVA_PELVIC_FIXTURE.initialState as Record<string, any>;
    const chest = NARVA_CHEST_FIXTURE.initialState as Record<string, any>;
    expect(pelvic.baselineVitals).toEqual({ hr: 118, sbp: 110, dbp: 70, rr: 24, spo2: 97, gcs: 15 });
    expect(chest.baselineVitals).toEqual({ hr: 125, sbp: 103, dbp: 65, rr: 34, spo2: 85, gcs: 15 });
    expect(byVitalId.get("P01-V0")?.vitalRow.values).toMatchObject(pelvic.baselineVitals);
    expect(byVitalId.get("P02-V0")?.vitalRow.values).toMatchObject(chest.baselineVitals);
  });

  test("SRC-G26..SRC-G29 keep later rows descriptive and dynamic physiology authoritative", () => {
    const later = vitalItems.filter(item => item.vitalRow.minute > 0);
    expect(later).toHaveLength(9);
    expect(later.every(item => !item.vitalRow.exactRuntimeTarget &&
      item.vitalRow.productionRelationship === "DESCRIPTIVE_REFERENCE")).toBe(true);
    expect(manifest.scriptedVitalsPolicy).toEqual({ canonicalRuntimeAuthority: "DYNAMIC_PHYSIOLOGY",
      laterRowsAreExactRuntimeTargets: false, scriptedOverrides: false, numericToleranceModel: null,
      authorityDecisionRequiredForPlayback: true });
    expect(later.every(item => !(item as Record<string, unknown>).tolerance)).toBe(true);
    const source = productionFiles(resolve(root, "src")).map(path => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/P01-V10|P01-V20|P01-V30-STAB|P01-V105|P02-V10|P02-V20|P02-V50-TRANSPORT|P02-V60-DELAY|P02-V90-DELAY/u);
  });

  test("SRC-G24 records only explicit row-identity phase hints", () => {
    expect(Object.fromEntries(vitalItems.flatMap(item => item.vitalRow.phaseHint
      ? [[item.vitalRow.vitalId, item.vitalRow.phaseHint]] : []))).toEqual({
      "P01-V30-STAB": "STABILIZATION_CONTEXT", "P02-V50-TRANSPORT": "TRANSPORT_CONTEXT",
      "P02-V60-DELAY": "DELAY_CONTEXT", "P02-V90-DELAY": "LATER_DELAY_CONTEXT",
    });
  });

  test("SRC-G30 produces deterministic privacy-safe metadata and summary input", () => {
    const serialized = JSON.stringify(vitalItems);
    expect(serialized).not.toMatch(/isikukood|national.?id|patient.?name/iu);
    const first = core.summarizeFidelity(vitalItems.map(item => ({ ...item, drift: null })));
    const second = core.summarizeFidelity(vitalItems.map(item => ({ ...item, drift: null })));
    expect(second).toEqual(first);
  });
});
