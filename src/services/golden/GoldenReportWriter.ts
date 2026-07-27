import type { ImportCellValue, ImportSheetData } from "@/models/ModuleImport";
import type { GoldenRunReport } from "@/models/GoldenTest";

const assertionResultHeaders = [
  "AssertionID", "TestID", "Comparator", "ExpectedValue", "Tolerance",
  "ActualValue", "EvidenceRef", "ManualStatus", "CalculatedStatus",
  "FinalStatus", "RunnerNote",
] as const;

function text(value: ImportCellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function goldenReportJson(report: GoldenRunReport): string {
  return JSON.stringify(report, null, 2);
}

export function writeAssertionResults(
  source: ImportSheetData,
  report: GoldenRunReport
): ImportSheetData {
  const output = structuredClone(source);
  const headerIndex = output.findIndex((row) =>
    assertionResultHeaders.every((header) => row.some((cell) => text(cell) === header))
  );
  if (headerIndex < 0) throw new Error("AssertionResults lehe veeruleping ei vasta Golden Packile.");
  const indexes = Object.fromEntries(output[headerIndex].map((header, index) => [text(header), index]));
  const results = new Map(report.tests.flatMap((test) =>
    test.assertionResults.map((result) => [result.assertionId, result] as const)
  ));
  for (const row of output.slice(headerIndex + 1)) {
    const result = results.get(text(row[indexes.AssertionID]));
    if (!result) continue;
    row[indexes.ActualValue] = typeof result.actual === "object"
      ? JSON.stringify(result.actual)
      : result.actual as ImportCellValue;
    row[indexes.EvidenceRef] = result.evidenceRef ?? null;
    row[indexes.CalculatedStatus] = result.status;
    row[indexes.FinalStatus] = result.status;
    row[indexes.RunnerNote] = result.failureReason ?? `RunID ${report.runId}`;
  }
  return output;
}

