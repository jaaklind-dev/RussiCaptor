import type {
  GoldenActualEvent,
  GoldenComparator,
  GoldenExpectedEvent,
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
    if (matches.length > 0) {
      const firstIndex = matches[0].index;
      if (firstIndex < lastIndex) failures.push(`${item.eventType} sündmuste semantiline järjekord on vale.`);
      lastIndex = Math.max(lastIndex, firstIndex);
    }
  }
  return { status: failures.length === 0 ? "PASS" : "FAIL", failures };
}

