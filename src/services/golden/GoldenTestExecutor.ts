import type {
  GoldenAssertionResult,
  GoldenExecutionOutput,
  GoldenFixture,
  GoldenInputEvent,
  GoldenAssertion,
  GoldenRunReport,
  GoldenTestCase,
  GoldenWorkbook,
} from "@/models/GoldenTest";
import { loadEventSequence, loadFixture } from "@/providers/excel/GoldenWorkbookLoader";
import {
  compareEvents,
  compareGoldenValue,
  compareProcessTree,
  compareReplay,
} from "@/services/golden/GoldenComparators";

export const goldenRunnerVersion = "WP-4B/1.0";

export type GoldenRunnerAdapter = {
  execute(input: {
    test: GoldenTestCase;
    fixture: GoldenFixture;
    events: GoldenInputEvent[];
    checkpoints: number[];
    assertions: GoldenAssertion[];
  }): Promise<GoldenExecutionOutput>;
};

export type GoldenRunOptions = {
  runId: string;
  commitHash?: string;
  testIds?: string[];
  failFastP0?: boolean;
  now?: () => Date;
};

const p0PrefixOrder = ["IMP", "CORE", "BOT", "HV", "XMOD", "PAT", "RES"];

function testOrder(left: GoldenTestCase, right: GoldenTestCase): number {
  const priority = (left.priority === "P0" ? 0 : 1) - (right.priority === "P0" ? 0 : 1);
  if (priority) return priority;
  const leftPrefix = left.testId.split("-")[0];
  const rightPrefix = right.testId.split("-")[0];
  const prefix = p0PrefixOrder.indexOf(leftPrefix) - p0PrefixOrder.indexOf(rightPrefix);
  return prefix || left.testId.localeCompare(right.testId);
}

function selector(query: string): Record<string, string> {
  const content = query.match(/\[([^\]]*)\]/)?.[1] ?? "";
  return Object.fromEntries(content.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [[part.slice(0, index).trim(), part.slice(index + 1).trim()]];
  }));
}

function assertionActual(assertion: GoldenWorkbook["assertions"][number], output: GoldenExecutionOutput): unknown {
  const checkpointValue = output.checkpointValues?.[String(assertion.checkpointSec)]?.[assertion.queryOrField];
  if (checkpointValue !== undefined) return checkpointValue;
  if (Object.hasOwn(output.values, assertion.queryOrField)) return output.values[assertion.queryOrField];
  if (output.snapshots && Object.hasOwn(output.snapshots, assertion.queryOrField)) {
    return output.snapshots[assertion.queryOrField];
  }
  if (assertion.assertionType === "EVENT") {
    const filters = selector(assertion.queryOrField);
    return output.events.filter((event) =>
      (!filters.type || event.eventType === filters.type) &&
      (!filters.target || event.target === filters.target) &&
      (!filters.sourceModule || event.sourceModule === filters.sourceModule)
    );
  }
  if (assertion.assertionType === "PROCESS_TREE") {
    const filters = selector(assertion.queryOrField);
    return (output.processTree ?? []).filter((node) =>
      node.checkpointSec === assertion.checkpointSec &&
      (!filters.parentType || node.parentProcessType === filters.parentType) &&
      (!filters.parentId || filters.parentId === "ANY" || node.parentProcessId === filters.parentId) &&
      (!filters.childType || node.childProcessType === filters.childType) &&
      (!filters.template || node.childTemplateId === filters.template) &&
      (!filters.status || filters.status.split("/").includes(node.status))
    );
  }
  return undefined;
}

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
  ).sort(testOrder);
  const seedByFixture: Record<string, number> = {};
  const tests = [];
  let lastOutput: GoldenExecutionOutput | undefined;
  let p0Stopped = false;
  for (const test of selected) {
    const assertions = workbook.assertions.filter((item) => item.testId === test.testId);
    if (p0Stopped) {
      tests.push({
        testId: test.testId,
        status: "NOT_RUN" as const,
        assertionResults: assertions.map((assertion) => ({
          runId: options.runId, testId: test.testId, assertionId: assertion.assertionId,
          status: "NOT_RUN" as const, expected: assertion.expectedValue, actual: null,
          tolerance: assertion.tolerance, failureReason: "Eelnev P0 test ebaõnnestus või blokeerus.",
        })),
        eventComparison: { status: "NOT_RUN" as const, failures: [] },
        processTreeComparison: { status: "NOT_RUN" as const, failures: [] },
        replayComparison: { status: "NOT_RUN" as const, failures: [] },
      });
      continue;
    }
    try {
      const fixture = loadFixture(workbook, test.fixtureId);
      const events = loadEventSequence(workbook, test.eventSequenceId);
      seedByFixture[fixture.fixtureId] = fixture.seed;
      const output = await adapter.execute({
        test,
        fixture,
        events,
        checkpoints: [...new Set(assertions.map((item) => item.checkpointSec))].sort((a, b) => a - b),
        assertions,
      });
      lastOutput = output;
      const replayComparison = test.deterministic
        ? compareReplay(output, await adapter.execute({
          test, fixture: loadFixture(workbook, test.fixtureId),
          events: loadEventSequence(workbook, test.eventSequenceId),
          checkpoints: [...new Set(assertions.map((item) => item.checkpointSec))].sort((a, b) => a - b),
          assertions,
        }))
        : { status: "PASS" as const, failures: [] };
      const assertionResults = assertions.map((assertion): GoldenAssertionResult => {
        const actual = assertionActual(assertion, output);
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
      const processTreeComparison = compareProcessTree(
        workbook.expectedProcessTree.filter((item) => item.testId === test.testId),
        output.processTree ?? []
      );
      const status = assertionResults.some((item) => item.status === "FAIL") ||
        eventComparison.status === "FAIL" || processTreeComparison.status === "FAIL" ||
        replayComparison.status === "FAIL"
        ? "FAIL" as const
        : "PASS" as const;
      tests.push({
        testId: test.testId, status, assertionResults, eventComparison,
        processTreeComparison, replayComparison,
        stateHash: output.stateHash, eventLogHash: output.eventLogHash,
        processTreeHash: output.processTreeHash,
      });
      if (test.priority === "P0" && status === "FAIL" && options.failFastP0 !== false) p0Stopped = true;
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
        processTreeComparison: { status: "BLOCKED" as const, failures: [reason] },
        replayComparison: { status: "BLOCKED" as const, failures: [reason] },
      });
      if (test.priority === "P0" && options.failFastP0 !== false) p0Stopped = true;
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
