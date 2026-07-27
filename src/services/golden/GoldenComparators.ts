import type {
  GoldenActualEvent,
  GoldenComparator,
  GoldenExpectedEvent,
  GoldenExpectedProcess,
  GoldenActualProcess,
  GoldenExecutionOutput,
  GoldenExpectedSnapshot,
  GoldenStatus,
} from "@/models/GoldenTest";

export type ComparisonResult = {
  status: GoldenStatus;
  actual: unknown;
  failureReason?: string;
};

function comparable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value).trim();
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (text.toUpperCase() === "TRUE") return true;
  if (text.toUpperCase() === "FALSE") return false;
  return text;
}

function list(value: unknown, separator: string): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  return String(value ?? "").split(separator).map((item) => item.trim()).filter(Boolean);
}

export function compareGoldenValue(
  comparator: GoldenComparator,
  expected: string,
  actual: unknown,
  tolerance: number
): ComparisonResult {
  let passed = false;
  if (comparator === "EQ") passed = comparable(actual) === comparable(expected);
  if (comparator === "NEAR") {
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    passed = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) &&
      Math.abs(actualNumber - expectedNumber) <= tolerance;
  }
  if (comparator === "COUNT_EQ") {
    const actualCount = Array.isArray(actual) ? actual.length : Number(actual);
    passed = actualCount === Number(expected);
  }
  if (comparator === "SET_EQ") {
    const expectedSet = [...new Set(list(expected, "|"))].sort();
    const actualSet = [...new Set(list(actual, "|"))].sort();
    passed = JSON.stringify(actualSet) === JSON.stringify(expectedSet);
  }
  if (comparator === "LIST_EQ") {
    passed = JSON.stringify(list(actual, ">")) === JSON.stringify(list(expected, ">"));
  }
  if (comparator === "IN") {
    passed = list(expected, "|").some((candidate) => comparable(candidate) === comparable(actual));
  }
  return passed ? { status: "PASS", actual } : {
    status: "FAIL",
    actual,
    failureReason: `${comparator}: oodatud ${expected}, tegelik ${JSON.stringify(actual)}.`,
  };
}

export function snapshotKey(snapshot: GoldenExpectedSnapshot): string {
  return [snapshot.patientId || "*", snapshot.scope, snapshot.fieldPath].join("::");
}

export function compareSnapshot(
  expected: GoldenExpectedSnapshot,
  actualValues: Record<string, unknown>
): ComparisonResult {
  return compareGoldenValue(
    expected.comparator,
    expected.expectedValue,
    actualValues[snapshotKey(expected)],
    expected.tolerance
  );
}

function orderedEvents(events: GoldenActualEvent[]): GoldenActualEvent[] {
  return [...events].sort((a, b) =>
    (a.simulationTime ?? 0) - (b.simulationTime ?? 0) ||
    (a.enginePhase ?? 0) - (b.enginePhase ?? 0) ||
    (a.sequence ?? 0) - (b.sequence ?? 0)
  );
}

export function compareEvents(
  expected: GoldenExpectedEvent[],
  actual: GoldenActualEvent[]
): { status: GoldenStatus; failures: string[] } {
  const orderedExpected = [...expected].sort((a, b) => a.expectedOrder - b.expectedOrder);
  const orderedActual = orderedEvents(actual);
  const failures: string[] = [];
  let lastIndex = -1;
  for (const item of orderedExpected) {
    const matches = orderedActual.flatMap((event, index) =>
      event.eventType === item.eventType &&
      (!item.sourceModule || event.sourceModule === item.sourceModule) &&
      (!item.target || event.target === item.target)
        ? [{ event, index }]
        : []
    );
    if (matches.length !== item.expectedCount) {
      failures.push(`${item.eventType}: oodatud ${item.expectedCount}, tegelik ${matches.length}.`);
    }
    if (item.mustNotExist && matches.length > 0) {
      failures.push(`${item.eventType} ei tohi sündmuslogis esineda.`);
    }
    if (item.required && matches.length === 0) {
      failures.push(`${item.eventType} kohustuslik sündmus puudub.`);
    }
    if (item.attributionRule?.toLowerCase().includes("sourceprocessid") && matches.length > 0) {
      const missingAttribution = matches.some(({ event }) => {
        const payload = event.payload;
        return !payload || typeof payload !== "object" ||
          !("sourceProcessId" in payload || "sourceProcessID" in payload);
      });
      if (missingAttribution) failures.push(`${item.eventType}: sourceProcessID omistus puudub.`);
    }
    if (matches.length > 0) {
      const firstIndex = matches[0].index;
      if (firstIndex < lastIndex) failures.push(`${item.eventType} sündmuste semantiline järjekord on vale.`);
      lastIndex = Math.max(lastIndex, firstIndex);
    }
  }
  return { status: failures.length === 0 ? "PASS" : "FAIL", failures };
}

function processMatches(expected: GoldenExpectedProcess, actual: GoldenActualProcess): boolean {
  const parentMatches = expected.parentProcessId === "ANY" ||
    expected.parentProcessId === actual.parentProcessId;
  const statusMatches = expected.expectedStatus === "None" ||
    expected.expectedStatus.split("/").includes(actual.status);
  return actual.checkpointSec === expected.checkpointSec &&
    actual.parentProcessType === expected.parentProcessType && parentMatches &&
    actual.childProcessType === expected.childProcessType &&
    actual.childTemplateId === expected.childTemplateId && statusMatches;
}

export function compareProcessTree(
  expected: GoldenExpectedProcess[],
  actual: GoldenActualProcess[]
): { status: GoldenStatus; failures: string[] } {
  const failures: string[] = [];
  for (const item of expected) {
    const matches = actual.filter((node) => processMatches(item, node));
    if (matches.length !== item.expectedActiveCount) {
      failures.push(
        `${item.childTemplateId}@${item.checkpointSec}: oodatud ${item.expectedActiveCount}, tegelik ${matches.length}.`
      );
    }
    if (item.mustNotExist && matches.length > 0) {
      failures.push(`${item.childTemplateId} ei tohi protsessipuus esineda.`);
    }
    if (!item.mustNotExist && item.instanceKeyRule && matches.some((node) => !node.instanceKey)) {
      failures.push(`${item.childTemplateId}: semantiline instance key puudub.`);
    }
    const instanceKeys = matches.map((node) => node.instanceKey).filter(Boolean);
    if (new Set(instanceKeys).size !== instanceKeys.length) {
      failures.push(`${item.childTemplateId}: sama instance key esineb protsessipuus mitu korda.`);
    }
  }
  return { status: failures.length === 0 ? "PASS" : "FAIL", failures };
}

function normalizeSemantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSemantic);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["insertedAt", "updatedAt", "createdAt", "importRunId", "ImportRunID", "databasePk"]
      .includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, normalizeSemantic(nested)]));
}

function replaySemantic(output: GoldenExecutionOutput): unknown {
  return normalizeSemantic({
    values: output.values,
    checkpointValues: output.checkpointValues,
    snapshots: output.snapshots,
    events: orderedEvents(output.events).map(({ insertedAt: _insertedAt, ...event }) => event),
    processTree: [...(output.processTree ?? [])].sort((left, right) =>
      left.checkpointSec - right.checkpointSec ||
      left.parentProcessType.localeCompare(right.parentProcessType) ||
      left.parentProcessId.localeCompare(right.parentProcessId) ||
      left.childProcessType.localeCompare(right.childProcessType) ||
      left.childTemplateId.localeCompare(right.childTemplateId) ||
      left.status.localeCompare(right.status)
    ),
    stateHash: output.stateHash,
    eventLogHash: output.eventLogHash,
    processTreeHash: output.processTreeHash,
  });
}

export function compareReplay(
  first: GoldenExecutionOutput,
  second: GoldenExecutionOutput
): { status: GoldenStatus; failures: string[] } {
  const passed = JSON.stringify(replaySemantic(first)) === JSON.stringify(replaySemantic(second));
  return passed
    ? { status: "PASS", failures: [] }
    : { status: "FAIL", failures: ["Sama fixture, seed ja event log ei andnud semantiliselt identset tulemust."] };
}
