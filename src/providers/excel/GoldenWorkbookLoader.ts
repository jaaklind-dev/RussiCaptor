import { readSheet } from "read-excel-file/universal";

import type { ImportCellValue, ImportSheetData } from "@/models/ModuleImport";
import type {
  GoldenAssertion,
  GoldenComparator,
  GoldenExpectedEvent,
  GoldenExpectedSnapshot,
  GoldenFixture,
  GoldenInputEvent,
  GoldenTestCase,
  GoldenWorkbook,
} from "@/models/GoldenTest";

export const goldenRequiredSheets = [
  "README", "TestCatalog", "Fixtures", "EventSequences", "Assertions",
  "ExpectedSnapshots", "ExpectedEvents", "AssertionResults",
] as const;

type Row = Record<string, ImportCellValue>;

function text(value: ImportCellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function number(value: ImportCellValue | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Arvuline väärtus puudub või on vigane: ${text(value)}`);
  return parsed;
}

function bool(value: ImportCellValue | undefined): boolean {
  return value === true || text(value).toUpperCase() === "TRUE";
}

function json(value: ImportCellValue | undefined, field: string): unknown {
  try {
    return JSON.parse(text(value) || "null");
  } catch {
    throw new Error(`${field} sisaldab vigast JSON-i.`);
  }
}

function rows(sheet: ImportSheetData, requiredHeaders: string[]): Row[] {
  const headerIndex = sheet.findIndex((candidate) =>
    requiredHeaders.every((header) => candidate.some((cell) => text(cell) === header))
  );
  if (headerIndex < 0) throw new Error(`Nõutud veerupäised puuduvad: ${requiredHeaders.join(", ")}`);
  const headers = sheet[headerIndex].map(text);
  return sheet.slice(headerIndex + 1).flatMap((values) => {
    if (values.every((value) => text(value) === "")) return [];
    const row: Row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? null;
    });
    return [row];
  });
}

function metadata(sheet: ImportSheetData): Record<string, string> {
  return Object.fromEntries(sheet.flatMap((row) => {
    const key = text(row[0]);
    const value = text(row[1]);
    return key && value ? [[key, value]] : [];
  }));
}

export function parseGoldenWorkbookSheets(sheets: Record<string, ImportSheetData>): GoldenWorkbook {
  for (const name of goldenRequiredSheets) {
    if (!sheets[name]) throw new Error(`Golden workbooki kohustuslik leht ${name} puudub.`);
  }
  const meta = metadata(sheets.README);
  const tests: GoldenTestCase[] = rows(sheets.TestCatalog, ["TestID", "FixtureID", "EventSequenceID"]).map((row) => ({
    testId: text(row.TestID), title: text(row.Title), priority: text(row.Priority),
    fixtureId: text(row.FixtureID), eventSequenceId: text(row.EventSequenceID),
    assertionGroupId: text(row.AssertionGroupID), deterministic: bool(row.Deterministic),
    automated: bool(row.Automated),
  }));
  const fixtures: GoldenFixture[] = rows(sheets.Fixtures, ["FixtureID", "Seed", "InitialStateJSON"]).map((row) => ({
    fixtureId: text(row.FixtureID), fixtureType: text(row.FixtureType),
    patientId: text(row.PatientID) || undefined, seed: number(row.Seed),
    clockState: text(row.ClockState), ownerCm: text(row.OwnerCM) || undefined,
    ownershipVersion: number(row.ownershipVersion),
    initialState: json(row.InitialStateJSON, `${text(row.FixtureID)} InitialStateJSON`),
    activeResources: json(row.ActiveResourcesJSON, `${text(row.FixtureID)} ActiveResourcesJSON`),
    loadedModules: json(row.LoadedModulesJSON, `${text(row.FixtureID)} LoadedModulesJSON`),
  }));
  const eventSequences: GoldenInputEvent[] = rows(sheets.EventSequences, ["SequenceID", "Step", "EventType"]).map((row) => ({
    sequenceId: text(row.SequenceID), step: number(row.Step), offsetSec: number(row.OffsetSec),
    eventType: text(row.EventType), actor: text(row.Actor), target: text(row.Target),
    eventId: text(row.EventID), actionId: text(row.ActionID) || undefined, result: text(row.Result),
    payload: json(row.PayloadJSON, `${text(row.EventID)} PayloadJSON`),
    expectedGeneratedEvent: text(row.ExpectedGeneratedEvent) || undefined,
  }));
  const assertions: GoldenAssertion[] = rows(sheets.Assertions, ["AssertionID", "TestID", "Comparator"]).map((row) => ({
    assertionId: text(row.AssertionID), assertionGroupId: text(row.AssertionGroupID),
    testId: text(row.TestID), assertionType: text(row.AssertionType),
    checkpointSec: number(row.CheckpointSec), queryOrField: text(row.QueryOrField),
    comparator: text(row.Comparator) as GoldenComparator, expectedValue: text(row.ExpectedValue),
    tolerance: number(row.Tolerance), severity: text(row.Severity), sourceRef: text(row.SourceRef) || undefined,
  }));
  const expectedSnapshots: GoldenExpectedSnapshot[] = rows(sheets.ExpectedSnapshots, ["TestID", "FieldPath", "Comparator"]).map((row) => ({
    testId: text(row.TestID), checkpointSec: number(row.CheckpointSec),
    patientId: text(row.PatientID) || undefined, scope: text(row.Scope), fieldPath: text(row.FieldPath),
    comparator: text(row.Comparator) as GoldenComparator, expectedValue: text(row.ExpectedValue),
    tolerance: number(row.Tolerance),
  }));
  const expectedEvents: GoldenExpectedEvent[] = rows(sheets.ExpectedEvents, ["TestID", "EventType", "ExpectedCount"]).map((row) => ({
    testId: text(row.TestID), expectedOrder: number(row.ExpectedOrder), eventType: text(row.EventType),
    expectedCount: number(row.ExpectedCount), sourceModule: text(row.SourceModule), target: text(row.Target),
    required: bool(row.Required), mustNotExist: bool(row.MustNotExist),
    attributionRule: text(row.AttributionRule) || undefined,
  }));
  if (!meta.PackID || !meta.PackVersion) throw new Error("Golden workbooki PackID või PackVersion puudub.");
  return { packId: meta.PackID, packVersion: meta.PackVersion, tests, fixtures, eventSequences, assertions, expectedSnapshots, expectedEvents, sheets };
}

export async function loadGoldenWorkbook(buffer: ArrayBuffer): Promise<GoldenWorkbook> {
  const entries = await Promise.all(goldenRequiredSheets.map(async (name) => {
    try {
      return [name, await readSheet(buffer, name, { trim: false }) as ImportSheetData] as const;
    } catch {
      throw new Error(`Golden workbooki kohustuslik leht ${name} puudub või pole loetav.`);
    }
  }));
  return parseGoldenWorkbookSheets(Object.fromEntries(entries));
}

export function loadFixture(workbook: GoldenWorkbook, fixtureId: string): GoldenFixture {
  const fixture = workbook.fixtures.find((item) => item.fixtureId === fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} puudub.`);
  return structuredClone(fixture);
}

export function loadEventSequence(workbook: GoldenWorkbook, sequenceId: string): GoldenInputEvent[] {
  const events = workbook.eventSequences.filter((item) => item.sequenceId === sequenceId)
    .sort((a, b) => a.step - b.step);
  if (events.length === 0) throw new Error(`Event sequence ${sequenceId} puudub.`);
  return structuredClone(events);
}

