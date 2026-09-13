import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { IncrementalSha256, sha256Text, sha256TextAsync, utf8Slice } from "@/utils/sha256";
import {
  stableJson,
  stableJsonHashAsync,
  type StableJsonHashMetrics,
} from "@/utils/stableJson";

jest.setTimeout(120_000);

const MB = 1024 * 1024;

const streamHash = (value: unknown, onHashComplete?: (metrics: StableJsonHashMetrics) => void) =>
  stableJsonHashAsync(value, {
    objectTraversal: "NATIVE_JSON_SHAPE_TRIE",
    yieldEvery: 128,
    maxSliceMs: 8,
    hashBlocksPerSlice: 16,
    chunkCharacters: 32_768,
    yieldControl: () => Promise.resolve(),
    onHashComplete,
  });

function smallObjectFixture(targetBytes: number) {
  const rowCount = 16_000;
  const bodyLength = Math.max(16, Math.floor(targetBytes / rowCount) - 96);
  return {
    exerciseId: "EX-HERMES-STREAM-HASH",
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `IRO-EVENT-${index}`,
      sequence: index,
      kind: index % 2 ? "HOLD" : "FAULT",
      simulationTimeSec: 2_622 + index,
      payload: "x".repeat(bodyLength),
    })),
  };
}

describe("WP-NARVA-10B13 canonical stream hashing", () => {
  test("matches sha256Text(stableJson(value)) across JSON and Unicode boundaries", async () => {
    const values: unknown[] = [
      null, true, false, 0, -1, 1.5, "", "ASCII", "õäöü", "ЯЄЇҐ", "😀💉𐀀",
      "a\ud800b", "a\udc00b", "x".repeat(32_767) + "😀" + "y".repeat(32_769),
      [undefined, null, false, 0, ""],
      { undefinedValue: undefined, nullValue: null, falseValue: false, zeroValue: 0, emptyValue: "" },
      { "0": "zero", "1": "one", "10": "ten", "2": "two", õ: "Estonian", Я: "Cyrillic" },
    ];
    for (const value of values) {
      expect(await streamHash(value)).toBe(sha256Text(stableJson(value)));
    }
  });

  test("keeps incremental text SHA byte-identical across tiny slices", async () => {
    const values = ["", "abc", "õ😀Я", "a\ud800b", "x".repeat(100_000) + "😀tail"];
    for (const value of values) {
      expect(await sha256TextAsync(value, {
        charactersPerSlice: 1,
        blocksPerSlice: 1,
        yieldControl: () => Promise.resolve(),
      })).toBe(sha256Text(value));
    }
  });

  test("a truncated canonical byte stream cannot produce the expected digest", () => {
    const canonical = stableJson({ exerciseId: "EX-TRUNCATED", rows: [1, 2, 3], unicode: "õ😀" });
    const bytes = utf8Slice(canonical, 0, canonical.length);
    const hash = new IncrementalSha256();
    hash.update(bytes.subarray(0, bytes.length - 1));
    expect(hash.digest()).not.toBe(sha256Text(canonical));
  });

  test("matches package and dataset canonical hashes without materializing a stream string", async () => {
    const values = exercisePackageRegistry.packages.flatMap(pkg => [
      pkg,
      packagePatientDatasetRegistry.resolve(pkg.patientDatasetId),
    ]);
    for (const value of values) {
      expect(await streamHash(value)).toBe(sha256Text(stableJson(value)));
    }
  });

  test("reduces the retained-like small-object output to bounded stream chunks", async () => {
    const fixture = smallObjectFixture(3 * MB);
    const canonical = stableJson(fixture);
    let metrics: StableJsonHashMetrics | undefined;
    const slices: number[] = [];
    const started = performance.now();
    const hash = await stableJsonHashAsync(fixture, {
      objectTraversal: "NATIVE_JSON_SHAPE_TRIE",
      yieldEvery: 128,
      maxSliceMs: 8,
      hashBlocksPerSlice: 16,
      chunkCharacters: 32_768,
      yieldControl: () => Promise.resolve(),
      onSlice: duration => slices.push(duration),
      onHashComplete: result => { metrics = result; },
    });
    const durationMs = performance.now() - started;

    expect(hash).toBe(sha256Text(canonical));
    expect(metrics!.canonicalCharacters).toBe(canonical.length);
    expect(metrics!.chunkCount).toBeLessThan(200);
    expect(metrics!.averageChunkCharacters).toBeGreaterThan(16_000);
    expect(metrics!.maxChunkCharacters).toBeLessThanOrEqual(32_768);
    expect(Math.max(...slices)).toBeLessThan(250);
    console.info("WP_NARVA_10B13_STREAM_PROFILE", JSON.stringify({
      bytes: canonical.length,
      valueVisits: 96_003,
      fragmentCountBefore: 433_133,
      chunkCountAfter: metrics!.chunkCount,
      averageChunkCharacters: Number(metrics!.averageChunkCharacters.toFixed(2)),
      maxChunkCharacters: metrics!.maxChunkCharacters,
      tokenWrites: metrics!.tokenWriteCount,
      utf8DurationMs: Number(metrics!.utf8DurationMs.toFixed(2)),
      shaDurationMs: Number(metrics!.shaDurationMs.toFixed(2)),
      totalMs: Number(durationMs.toFixed(2)),
      maxSliceMs: Number(Math.max(...slices).toFixed(2)),
    }));
  });

  test("streams a few large string fields with safe chunk boundaries", async () => {
    const fixture = {
      first: "õ😀".repeat(400_000),
      second: "Я💉".repeat(300_000),
      final: "tail\ud800",
    };
    const canonical = stableJson(fixture);
    let metrics: StableJsonHashMetrics | undefined;
    const started = performance.now();
    expect(await streamHash(fixture, result => { metrics = result; })).toBe(sha256Text(canonical));
    console.info("WP_NARVA_10B13_LARGE_STRING_PROFILE", JSON.stringify({
      bytes: canonical.length,
      chunkCount: metrics!.chunkCount,
      utf8Bytes: metrics!.utf8Bytes,
      durationMs: Number((performance.now() - started).toFixed(2)),
    }));
    expect(metrics!.maxChunkCharacters).toBeLessThanOrEqual(32_769);
  });

  test("profiles stream hashing from 1.8 MB through 16 MB", async () => {
    const profile: Record<string, number>[] = [];
    for (const targetMb of [1.8, 3, 4, 8, 12, 16]) {
      const fixture = smallObjectFixture(Math.floor(targetMb * MB));
      const canonical = stableJson(fixture);
      let metrics: StableJsonHashMetrics | undefined;
      const started = performance.now();
      const hash = await streamHash(fixture, result => { metrics = result; });
      expect(hash).toBe(sha256Text(canonical));
      profile.push({
        targetMb,
        bytes: canonical.length,
        chunks: metrics!.chunkCount,
        utf8Ms: Number(metrics!.utf8DurationMs.toFixed(2)),
        shaMs: Number(metrics!.shaDurationMs.toFixed(2)),
        totalMs: Number((performance.now() - started).toFixed(2)),
      });
    }
    console.info("WP_NARVA_10B13_SIZE_PROFILE", JSON.stringify(profile));
  });
});
