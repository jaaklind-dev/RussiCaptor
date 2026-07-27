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

export function writeRunResults(
  source: ImportSheetData,
  report: GoldenRunReport
): ImportSheetData {
  const output = structuredClone(source);
  const required = [
    "TestID", "PassAssertions", "FailAssertions", "BlockedAssertions", "NotRunAssertions",
    "Runner", "RunID", "RunDate", "CalculatedStatus", "FinalStatus", "EvidenceSummary",
  ];
  const headerIndex = output.findIndex((row) =>
    required.every((header) => row.some((cell) => text(cell) === header))
  );
  if (headerIndex < 0) throw new Error("RunResults lehe veeruleping ei vasta Golden Packile.");
  const indexes = Object.fromEntries(output[headerIndex].map((header, index) => [text(header), index]));
  const tests = new Map(report.tests.map((test) => [test.testId, test]));
  for (const row of output.slice(headerIndex + 1)) {
    const result = tests.get(text(row[indexes.TestID]));
    if (!result) continue;
    const count = (status: string) => result.assertionResults.filter((item) => item.status === status).length;
    row[indexes.PassAssertions] = count("PASS");
    row[indexes.FailAssertions] = count("FAIL");
    row[indexes.BlockedAssertions] = count("BLOCKED");
    row[indexes.NotRunAssertions] = count("NOT_RUN");
    row[indexes.Runner] = report.runnerVersion;
    row[indexes.RunID] = report.runId;
    row[indexes.RunDate] = report.finishedAt;
    row[indexes.CalculatedStatus] = result.status;
    row[indexes.FinalStatus] = result.status;
    row[indexes.EvidenceSummary] = [
      result.stateHash && `state=${result.stateHash}`,
      result.eventLogHash && `events=${result.eventLogHash}`,
      result.processTreeHash && `tree=${result.processTreeHash}`,
      ...result.eventComparison.failures,
      ...result.processTreeComparison.failures,
      ...result.replayComparison.failures,
    ].filter(Boolean).join("; ") || `RunID ${report.runId}`;
  }
  return output;
}
