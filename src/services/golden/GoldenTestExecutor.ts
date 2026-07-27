import type {
  GoldenAssertionResult,
  GoldenExecutionOutput,
  GoldenFixture,
  GoldenInputEvent,
  GoldenRunReport,
  GoldenTestCase,
  GoldenWorkbook,
} from "@/models/GoldenTest";
import { loadEventSequence, loadFixture } from "@/providers/excel/GoldenWorkbookLoader";
import { compareEvents, compareGoldenValue } from "@/services/golden/GoldenComparators";

export const goldenRunnerVersion = "WP-4A/1.0";

export type GoldenRunnerAdapter = {
  execute(input: {
    test: GoldenTestCase;
    fixture: GoldenFixture;
    events: GoldenInputEvent[];
    checkpoints: number[];
  }): Promise<GoldenExecutionOutput>;
};

export type GoldenRunOptions = {
  runId: string;
  commitHash?: string;
  testIds?: string[];
  now?: () => Date;
};

function blockedResult(
  runId: string,
  testId: string,
  assertionId: string,
  expected: string,
  tolerance: number,
  reason: string
): GoldenAssertionResult {
  return { runId, testId, assertionId, status: "BLOCKED", expected, actual: null, tolerance, failureReason: reason };
}

export async function executeGoldenTests(
  workbook: GoldenWorkbook,
  adapter: GoldenRunnerAdapter,
  options: GoldenRunOptions
): Promise<GoldenRunReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const selected = workbook.tests.filter((test) =>
    test.automated && (!options.testIds || options.testIds.includes(test.testId))
  );
  const seedByFixture: Record<string, number> = {};
  const tests = [];
  let lastOutput: GoldenExecutionOutput | undefined;
  for (const test of selected) {
    const assertions = workbook.assertions.filter((item) => item.testId === test.testId);
    try {
      const fixture = loadFixture(workbook, test.fixtureId);
      const events = loadEventSequence(workbook, test.eventSequenceId);
      seedByFixture[fixture.fixtureId] = fixture.seed;
      const output = await adapter.execute({
        test,
        fixture,
        events,
        checkpoints: [...new Set(assertions.map((item) => item.checkpointSec))].sort((a, b) => a - b),
      });
      lastOutput = output;
      const assertionResults = assertions.map((assertion): GoldenAssertionResult => {
        const actual = output.values[assertion.queryOrField];
        const compared = compareGoldenValue(assertion.comparator, assertion.expectedValue, actual, assertion.tolerance);
        return {
          runId: options.runId,
          testId: test.testId,
          assertionId: assertion.assertionId,
          status: compared.status,
          expected: assertion.expectedValue,
          actual,
          tolerance: assertion.tolerance,
          evidenceRef: output.evidenceRef || assertion.sourceRef,
          failureReason: compared.failureReason,
        };
      });
      const eventComparison = compareEvents(
        workbook.expectedEvents.filter((item) => item.testId === test.testId),
        output.events
      );
      const status = assertionResults.some((item) => item.status === "FAIL") || eventComparison.status === "FAIL"
        ? "FAIL" as const
        : "PASS" as const;
      tests.push({ testId: test.testId, status, assertionResults, eventComparison });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      tests.push({
        testId: test.testId,
        status: "BLOCKED" as const,
        assertionResults: assertions.map((assertion) => blockedResult(
          options.runId, test.testId, assertion.assertionId,
          assertion.expectedValue, assertion.tolerance, reason
        )),
        eventComparison: { status: "BLOCKED" as const, failures: [reason] },
      });
    }
  }
  return {
    runId: options.runId,
    packId: workbook.packId,
    packVersion: workbook.packVersion,
    runnerVersion: goldenRunnerVersion,
    commitHash: options.commitHash,
    startedAt,
    finishedAt: now().toISOString(),
    seedByFixture,
    stateHash: lastOutput?.stateHash,
    eventLogHash: lastOutput?.eventLogHash,
    processTreeHash: lastOutput?.processTreeHash,
    tests,
  };
}

