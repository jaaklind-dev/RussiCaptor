import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { sha256Text } from "@/utils/sha256";
import { stableJson, stableJsonAsync, type StableJsonMetrics } from "@/utils/stableJson";

function legacyCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyCanonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, legacyCanonicalize(nested)]));
}

const legacyStableJson = (value: unknown): string => JSON.stringify(legacyCanonicalize(value));

function legacyStableJsonProfile(value: unknown): Readonly<{
  canonical: string;
  objectCount: number;
  sortCount: number;
  comparatorInvocationCount: number;
  totalSortDurationMs: number;
}> {
  let objectCount = 0;
  let sortCount = 0;
  let comparatorInvocationCount = 0;
  let totalSortDurationMs = 0;
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    objectCount += 1;
    const started = performance.now();
    const entries = Object.entries(current as Record<string, unknown>)
      .sort(([left], [right]) => {
        comparatorInvocationCount += 1;
        return left.localeCompare(right);
      });
    totalSortDurationMs += performance.now() - started;
    sortCount += 1;
    return Object.fromEntries(entries.map(([key, nested]) => [key, visit(nested)]));
  };
  return { canonical: JSON.stringify(visit(value)), objectCount, sortCount,
    comparatorInvocationCount, totalSortDurationMs };
}

function objectWithKeys(keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key, index) => [key, { index, key }]));
}

describe("WP-NARVA-10B11 Hermes canonical key ordering", () => {
  test("keeps the established localeCompare ordering across ASCII and Unicode", async () => {
    const matrices = [
      ["", "a", "A", "b", "B", "0", "10", "2", "_", "-", "."],
      ["a", "ä", "õ", "ö", "ü", "š", "ž", "á", "a\u0301"],
      ["Я", "А", "а", "я", "Є", "І", "Ї", "Ґ"],
      ["😀", "😃", "💉", "𐀀", "a", "\ud800", "\udc00"],
      ["00", "0", "01", "1", "2", "10", "4294967294", "4294967295", "-1"],
    ];
    for (const keys of matrices) {
      for (const order of [keys, [...keys].reverse()]) {
        const value = objectWithKeys(order);
        const legacy = legacyStableJson(value);
        expect(stableJson(value)).toBe(legacy);
        expect(await stableJsonAsync(value, { yieldEvery: 1 })).toBe(legacy);
      }
    }
  });

  test("is byte- and hash-equivalent for real immutable IRO package artifacts", async () => {
    const values = exercisePackageRegistry.packages.flatMap(pkg => [
      pkg,
      packagePatientDatasetRegistry.resolve(pkg.patientDatasetId),
    ]);
    for (const value of values) {
      const legacy = legacyStableJson(value);
      const current = stableJson(value);
      expect(current).toBe(legacy);
      expect(await stableJsonAsync(value, { yieldEvery: 4 })).toBe(legacy);
      expect(sha256Text(current)).toBe(sha256Text(legacy));
    }
  });

  test("sorts one repeated small-object shape once per canonicalization call", async () => {
    const rows = Array.from({ length: 16_000 }, (_, index) => ({
      id: `IRO-EVENT-${index}`,
      sequence: index,
      kind: index % 2 ? "HOLD" : "FAULT",
      simulationTimeSec: 2_622 + index,
      payload: "x".repeat(96),
    }));
    const value = { exerciseId: "EX-HERMES-SMALL-OBJECTS", rows };
    const legacyProfile = legacyStableJsonProfile(value);
    const legacy = legacyProfile.canonical;
    let metrics: StableJsonMetrics | undefined;
    const started = performance.now();
    const current = await stableJsonAsync(value, {
      yieldEvery: 128,
      maxSliceMs: 8,
      yieldControl: () => Promise.resolve(),
      onComplete: result => { metrics = result; },
    });
    const durationMs = performance.now() - started;
    expect(current).toBe(legacy);
    expect(metrics).toBeDefined();
    expect(metrics!.objectCount).toBe(16_001);
    expect(metrics!.keyOrderCacheHits).toBeGreaterThan(15_900);
    expect(metrics!.sortCount).toBeLessThan(10);
    expect(metrics!.comparatorInvocationCount).toBeLessThan(100);
    console.info("WP_NARVA_10B11_SMALL_OBJECT_PROFILE", JSON.stringify({
      bytes: current.length,
      durationMs: Number(durationMs.toFixed(2)),
      before: { ...legacyProfile, canonical: undefined,
        totalSortDurationMs: Number(legacyProfile.totalSortDurationMs.toFixed(2)) },
      after: metrics,
    }));
  });
});
