import type { ImportSheetData } from "@/models/ModuleImport";
import type { GoldenActualEvent } from "@/models/GoldenTest";
import { parseGoldenWorkbookSheets } from "@/providers/excel/GoldenWorkbookLoader";
import {
  compareEvents,
  compareGoldenValue,
  compareSnapshot,
} from "@/services/golden/GoldenComparators";
import { goldenReportJson, writeAssertionResults } from "@/services/golden/GoldenReportWriter";
import { executeGoldenTests } from "@/services/golden/GoldenTestExecutor";

function table(headers: string[], rows: ImportSheetData): ImportSheetData {
  return [["Title"], [], headers, ...rows];
}

function workbookSheets(): Record<string, ImportSheetData> {
  return {
    README: [["Title"], [], ["PackID", "PACK-1"], ["PackVersion", "1.0"]],
    TestCatalog: table(
      ["TestID", "Title", "Priority", "FixtureID", "EventSequenceID", "AssertionGroupID", "Deterministic", "Automated"],
      [["T-1", "Framework", "P0", "FX-1", "SEQ-1", "AG-1", "TRUE", "TRUE"]]
    ),
    Fixtures: table(
      ["FixtureID", "FixtureType", "PatientID", "Seed", "ClockState", "OwnerCM", "ownershipVersion", "InitialStateJSON", "ActiveResourcesJSON", "LoadedModulesJSON"],
      [["FX-1", "PROCESS", "PT-001", 42, "RUNNING", "CM-1", 1, "{\"value\":10}", "{}", "[\"CORE_ENGINE\"]"]]
    ),
    EventSequences: table(
      ["SequenceID", "Step", "OffsetSec", "EventType", "Actor", "Target", "EventID", "ActionID", "Result", "PayloadJSON", "ExpectedGeneratedEvent"],
      [["SEQ-1", 1, 0, "ACTION", "CM-1", "PT-001", "EV-1", "ACT-1", "SUCCESS", "{}", "DONE"]]
    ),
    Assertions: table(
      ["AssertionID", "AssertionGroupID", "TestID", "AssertionType", "CheckpointSec", "QueryOrField", "Comparator", "ExpectedValue", "Tolerance", "Severity", "SourceRef"],
      [["AS-1", "AG-1", "T-1", "SNAPSHOT", 60, "PT-001::State::value", "NEAR", "10", 0.01, "FATAL", "FX-1"]]
    ),
    ExpectedSnapshots: table(
      ["TestID", "CheckpointSec", "PatientID", "Scope", "FieldPath", "Comparator", "ExpectedValue", "Tolerance"],
      [["T-1", 60, "PT-001", "State", "value", "NEAR", "10", 0.01]]
    ),
    ExpectedEvents: table(
      ["TestID", "ExpectedOrder", "EventType", "ExpectedCount", "SourceModule", "Target", "Required", "MustNotExist", "AttributionRule"],
      [["T-1", 1, "DONE", 1, "CORE_ENGINE", "PT-001", "TRUE", "FALSE", "PatientID"]]
    ),
    AssertionResults: table(
      ["AssertionID", "TestID", "Comparator", "ExpectedValue", "Tolerance", "ActualValue", "EvidenceRef", "ManualStatus", "CalculatedStatus", "FinalStatus", "RunnerNote"],
      [["AS-1", "T-1", "NEAR", "10", 0.01, null, null, "Approved", "Not run", "Not run", null]]
    ),
  };
}

describe("WP-4A golden runner infrastructure", () => {
  test("loads the workbook contract, fixture JSON and event sequence", () => {
    const workbook = parseGoldenWorkbookSheets(workbookSheets());
    expect(workbook.packId).toBe("PACK-1");
    expect(workbook.fixtures[0]).toMatchObject({ seed: 42, initialState: { value: 10 } });
    expect(workbook.eventSequences[0]).toMatchObject({ eventId: "EV-1", payload: {} });
    expect(workbook.assertions[0].comparator).toBe("NEAR");
  });

  test.each([
    ["EQ", "TRUE", true, 0],
    ["NEAR", "10", 10.005, 0.01],
    ["COUNT_EQ", "2", [1, 2], 0],
    ["SET_EQ", "A|B", ["B", "A", "A"], 0],
    ["LIST_EQ", "A>B", ["A", "B"], 0],
    ["IN", "Active|Controlled", "Controlled", 0],
  ] as const)("supports %s comparator", (comparator, expected, actual, tolerance) => {
    expect(compareGoldenValue(comparator, expected, actual, tolerance).status).toBe("PASS");
  });

  test("compares snapshot keys and ordered semantic events", () => {
    const workbook = parseGoldenWorkbookSheets(workbookSheets());
    expect(compareSnapshot(workbook.expectedSnapshots[0], {
      "PT-001::State::value": 10.001,
    }).status).toBe("PASS");
    const actual: GoldenActualEvent[] = [{
      eventType: "DONE", sourceModule: "CORE_ENGINE", target: "PT-001",
      simulationTime: 10, enginePhase: 2, sequence: 1, insertedAt: "ignored",
    }];
    expect(compareEvents(workbook.expectedEvents, actual)).toEqual({ status: "PASS", failures: [] });
  });

  test("executes through an adapter and writes JSON plus AssertionResults", async () => {
    const workbook = parseGoldenWorkbookSheets(workbookSheets());
    const dates = [new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T10:00:01Z")];
    const report = await executeGoldenTests(workbook, {
      execute: async ({ fixture, events, checkpoints }) => {
        expect(fixture.seed).toBe(42);
        expect(events.map((item) => item.eventId)).toEqual(["EV-1"]);
        expect(checkpoints).toEqual([60]);
        return {
          values: { "PT-001::State::value": 10.001 },
          events: [{ eventType: "DONE", sourceModule: "CORE_ENGINE", target: "PT-001" }],
          stateHash: "state-hash",
          eventLogHash: "event-hash",
          processTreeHash: "tree-hash",
          evidenceRef: "evidence.json",
        };
      },
    }, { runId: "RUN-1", commitHash: "abc123", now: () => dates.shift()! });

    expect(report.tests[0].status).toBe("PASS");
    expect(goldenReportJson(report)).toContain('"runnerVersion": "WP-4A/1.0"');
    const resultSheet = writeAssertionResults(workbook.sheets.AssertionResults, report);
    expect(resultSheet[3]).toEqual([
      "AS-1", "T-1", "NEAR", "10", 0.01, 10.001, "evidence.json",
      "Approved", "PASS", "PASS", "RunID RUN-1",
    ]);
  });

  test("turns adapter failures into BLOCKED results", async () => {
    const workbook = parseGoldenWorkbookSheets(workbookSheets());
    const report = await executeGoldenTests(workbook, {
      execute: async () => { throw new Error("engine unavailable"); },
    }, { runId: "RUN-2", now: () => new Date("2026-07-27T10:00:00Z") });
    expect(report.tests[0].status).toBe("BLOCKED");
    expect(report.tests[0].assertionResults[0].failureReason).toBe("engine unavailable");
  });
});

