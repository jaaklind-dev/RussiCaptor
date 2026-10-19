import { sha256Text } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { assertCompleteRestore, assertOriginalSliceLimit, logSample, monotonicNow,
  phase, withMonotonicClock } from "../../../../../test/performance/CheckpointBenchmark";
import { createRuntimeCheckpoint, getRuntimeCheckpointCanonicalRepresentation,
  isValidRuntimeCheckpointAsync, restoreRuntimeCheckpointCanonicalRepresentation } from "../RuntimeCheckpointAuthorityService";

// Deliberate negative-test CPU work, not a sleep or acceptance warm-up. Its
// measured duration is never hardcoded into the sample passed to the real gate.
function slowCpuWork(): number {
  const start = monotonicNow();
  let value = "SYNTHETIC-NEGATIVE";
  do { value = sha256Text(value.repeat(20)); } while (monotonicNow() - start <= 260);
  return monotonicNow() - start;
}

function checkpoint() {
  const payload = { simulationTimeSec: 2622, sequence: 1, eventLog: [{ id: "EVENT-1" }] };
  return createRuntimeCheckpoint({
    exerciseSession: { exerciseId: "EX-BENCHMARK", lifecycleState: "RUNNING", simulationTimeSec: 2622 },
    patients: [{ id: "PT-1", name: "Synthetic" }], assignments: [], transfers: [], questions: [], labs: [],
    imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
    persistedRuntimeStates: [{ schemaVersion: 1, provenance: { exerciseId: "EX-BENCHMARK", patientId: "PT-1",
      packageId: "PKG", packageVersion: "1", packageHash: "pkg", definitionHash: "def", moduleCompositionHash: "modules" },
      capturedAtSimulationTimeSec: 2622, payload, payloadHash: sha256Text(stableJson(payload)) }],
  } as never, 26);
}

describe("large-checkpoint benchmark safety", () => {
  test("runtime clock is high-resolution/monotonic despite a backwards wall clock, then restored", async () => {
    const prior = performance.now;
    const wall = jest.spyOn(Date, "now").mockReturnValue(-1);
    try {
      await withMonotonicClock(async () => {
        const values = Array.from({ length: 1000 }, monotonicNow);
        logSample({ operation: "CLOCK_VERIFICATION", first: values[0], last: values.at(-1), count: values.length });
        expect(performance.now).toBe(monotonicNow);
        expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
        expect(values.at(-1)!).toBeGreaterThan(values[0]);
        expect(values.some(value => !Number.isInteger(value))).toBe(true);
      });
    } finally { wall.mockRestore(); }
    expect(performance.now).toBe(prior);
    await expect(withMonotonicClock(async () => { throw new Error("INTENTIONAL"); })).rejects.toThrow("INTENTIONAL");
    expect(performance.now).toBe(prior);
  });

  test("the strict original maximum rejects 250ms, a later outlier and invalid samples", () => {
    expect(() => assertOriginalSliceLimit([249.999])).not.toThrow();
    for (const samples of [[250], [1, 251, 2], [NaN], [Infinity], [-1], []]) {
      expect(() => assertOriginalSliceLimit(samples)).toThrow();
    }
  });

  test("a deliberately slower correct serializer is rejected by the same maximum gate", async () => {
    await withMonotonicClock(async () => {
      const input = { fixture: "SYNTHETIC-SLOW-IMPLEMENTATION" };
      const samples: number[] = [], record: Record<string, unknown> = {};
      const result = await phase("serializationMs", async () => {
        const started = monotonicNow();
        const text = stableJson(input);
        slowCpuWork();
        samples.push(monotonicNow() - started);
        return text;
      }, record);
      logSample({ ...record, operation: "NEGATIVE_SLOW_IMPLEMENTATION", samples });
      expect(result).toBe(stableJson(input));
      expect(() => assertOriginalSliceLimit(samples)).toThrow();
    });
  });

  test("a slow fixture is rejected using actual unchanged runtime onSlice reports", async () => {
    await withMonotonicClock(async () => {
      const input = { fixture: "SYNTHETIC-SLOW-FIXTURE", get value() { slowCpuWork(); return 1; } };
      const slices: number[] = [], record: Record<string, unknown> = {};
      const result = await phase("serializationMs", () => stableJsonAsync(input, {
        yieldEvery: 128, maxSliceMs: 8, yieldControl: async () => Promise.resolve(),
        objectTraversal: "NATIVE_JSON_SHAPE_TRIE", onSlice: duration => slices.push(duration),
      }), record);
      logSample({ ...record, operation: "NEGATIVE_SLOW_FIXTURE", slices });
      expect(result).toBe('{"fixture":"SYNTHETIC-SLOW-FIXTURE","value":1}');
      expect(() => assertOriginalSliceLimit(slices)).toThrow();
    });
  });

  test.each(["HASH", "SERIALIZED_DATA", "IDENTITY"] as const)("fast invalid %s restore is still rejected", async kind => {
    await withMonotonicClock(async () => {
      const source = checkpoint();
      const representation = getRuntimeCheckpointCanonicalRepresentation(source)!;
      const altered = kind === "HASH" ? { ...representation, payloadHash: "0".repeat(64) }
        : kind === "SERIALIZED_DATA" ? { ...representation, canonicalPayloadText: representation.canonicalPayloadText.slice(0, -1) }
          : { ...representation, exerciseId: "OTHER" };
      const record: Record<string, unknown> = {};
      let failure: unknown;
      try { await phase("restoreMs", () => restoreRuntimeCheckpointCanonicalRepresentation(altered, async () => Promise.resolve()), record); }
      catch (error) { failure = error; }
      logSample({ ...record, operation: `NEGATIVE_${kind}`, rejected: failure instanceof Error });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(kind === "IDENTITY" ? "CHECKPOINT_PROVENANCE_INVALID" : "CHECKPOINT_HASH_INVALID");
    });
  });

  test("an incomplete fast restore fails integrity even if its duration is tiny", async () => {
    await withMonotonicClock(async () => {
      const source = checkpoint(), record: Record<string, unknown> = {};
      const incomplete = await phase("restoreMs", () => ({ ...source, payload: { ...source.payload, patients: [] } }), record);
      logSample({ ...record, operation: "NEGATIVE_INCOMPLETE_RESTORE" });
      expect(() => assertCompleteRestore(source, incomplete)).toThrow();
      expect(await isValidRuntimeCheckpointAsync(incomplete, async () => Promise.resolve())).toBe(false);
    });
  });
});
