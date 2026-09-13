import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { sha256Text } from "@/utils/sha256";
import { stableJson, stableJsonAsync, type StableJsonMetrics } from "@/utils/stableJson";

jest.setTimeout(120_000);

async function nativeCheckpointJson(
  value: unknown,
  onComplete?: (metrics: StableJsonMetrics) => void,
): Promise<string> {
  return stableJsonAsync(value, {
    objectTraversal: "NATIVE_JSON_SHAPE_TRIE",
    yieldControl: () => Promise.resolve(),
    onComplete,
  });
}

describe("WP-NARVA-10B12 Hermes object traversal", () => {
  test("is byte-equivalent for optional, integer-like, Unicode and unknown keys", async () => {
    const value = {
      "10": "ten",
      "2": "two",
      unknownFutureField: { "": "empty-key", õ: "estonian", Я: "cyrillic", "😀": "emoji" },
      optionalUndefined: undefined,
      retainedNull: null,
      retainedFalse: false,
      retainedZero: 0,
      retainedEmpty: "",
      sparseArray: [undefined, null, 0, false, ""],
      nested: [{ z: 1, a: 2 }, { "1": "one", "0": "zero", extra: true }],
    };
    const expected = stableJson(value);
    const actual = await nativeCheckpointJson(value);
    expect(actual).toBe(expected);
    expect(Buffer.from(actual)).toEqual(Buffer.from(expected));
    expect(sha256Text(actual)).toBe(sha256Text(expected));
    expect(actual).toContain("unknownFutureField");
    expect(actual).not.toContain("optionalUndefined");
  });

  test("is byte- and hash-equivalent for every registered package and dataset", async () => {
    const values = exercisePackageRegistry.packages.flatMap(pkg => [
      pkg,
      packagePatientDatasetRegistry.resolve(pkg.patientDatasetId),
    ]);
    for (const value of values) {
      const expected = stableJson(value);
      const actual = await nativeCheckpointJson(value);
      expect(actual).toBe(expected);
      expect(sha256Text(actual)).toBe(sha256Text(expected));
    }
  });

  test("avoids per-object key arrays and shape signatures on the retained-like fixture", async () => {
    const rows = Array.from({ length: 16_000 }, (_, index) => ({
      id: `IRO-EVENT-${index}`,
      sequence: index,
      kind: index % 2 ? "HOLD" : "FAULT",
      simulationTimeSec: 2_622 + index,
      payload: "x".repeat(96),
    }));
    const value = { exerciseId: "EX-HERMES-OBJECT-TRAVERSAL", rows };
    const expected = stableJson(value);
    let metrics: StableJsonMetrics | undefined;
    const started = performance.now();
    const actual = await nativeCheckpointJson(value, result => { metrics = result; });
    const durationMs = performance.now() - started;

    expect(actual).toBe(expected);
    expect(actual.length).toBeGreaterThan(3_000_000);
    expect(metrics).toBeDefined();
    expect(metrics!.objectCount).toBe(16_001);
    expect(metrics!.objectKeysCalls).toBe(0);
    expect(metrics!.objectEntriesCalls).toBe(0);
    expect(metrics!.shapeSignatureBuilds).toBe(0);
    expect(metrics!.keyArrayAllocations).toBeLessThan(10);
    expect(metrics!.fastPathObjectCount).toBe(16_001);
    expect(metrics!.genericFallbackObjectCount).toBe(0);
    expect(metrics!.sortCount).toBeLessThan(10);

    console.info("WP_NARVA_10B12_OBJECT_TRAVERSAL_PROFILE", JSON.stringify({
      bytes: actual.length,
      durationMs: Number(durationMs.toFixed(2)),
      metrics,
    }));
  });

  test("interns the retained checkpoint's many-small-object shape distribution", async () => {
    const frequencies = [5_244, 2_622, 2_622, 2_622,
      ...Array.from({ length: 90 }, (_, index) => index < 51 ? 10 : 9)];
    const objects: Record<string, unknown>[] = [];
    frequencies.forEach((frequency, shapeIndex) => {
      const keyCount = [7, 4, 8, 5][shapeIndex] ?? 4 + shapeIndex % 8;
      for (let instance = 0; instance < frequency; instance += 1) {
        const row: Record<string, unknown> = {};
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
          row[`shape${shapeIndex}Key${keyIndex}`] = keyIndex === 0
            ? `IRO-${shapeIndex}-${instance}-${"x".repeat(120)}`
            : instance + keyIndex;
        }
        objects.push(row);
      }
    });
    const value = { objects };
    const expected = stableJson(value);
    let metrics: StableJsonMetrics | undefined;
    const actual = await nativeCheckpointJson(value, result => { metrics = result; });

    expect(actual).toBe(expected);
    expect(objects).toHaveLength(13_971);
    expect(metrics!.objectCount).toBe(13_972);
    expect(metrics!.objectKeysCalls).toBe(0);
    expect(metrics!.shapeSignatureBuilds).toBe(0);
    expect(metrics!.keyArrayAllocations).toBe(95);
    expect(metrics!.keyOrderCacheHits).toBe(13_877);
    expect(metrics!.genericFallbackObjectCount).toBe(0);
    console.info("WP_NARVA_10B12_RETAINED_SHAPE_PROFILE", JSON.stringify({
      bytes: actual.length,
      objects: metrics!.objectCount,
      uniqueShapes: metrics!.keyArrayAllocations,
      uniqueKeys: metrics!.uniqueCanonicalKeyCount,
      cacheHits: metrics!.keyOrderCacheHits,
      cacheMisses: metrics!.keyOrderCacheMisses,
    }));
  });

  test("keeps the generic canonicalizer as the default fallback", async () => {
    const value = { future: { z: 1, a: 2 }, rows: [{ beta: 2, alpha: 1 }] };
    let metrics: StableJsonMetrics | undefined;
    expect(await stableJsonAsync(value, {
      yieldControl: () => Promise.resolve(),
      onComplete: result => { metrics = result; },
    })).toBe(stableJson(value));
    expect(metrics!.genericFallbackObjectCount).toBe(3);
    expect(metrics!.objectKeysCalls).toBe(3);
    expect(metrics!.fastPathObjectCount).toBe(0);
  });
});
