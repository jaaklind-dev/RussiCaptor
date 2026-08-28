import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getSupabaseTrafficMetrics, resetSupabaseTrafficMetrics, setSupabaseTrafficMetricsEnabledForTests } from "@/services/SupabaseTrafficMetrics";
import { createRuntimeCheckpoint } from "../RuntimeCheckpointAuthorityService";
import { applyRuntimeCheckpointDelta, applyRuntimeCheckpointDeltaChain, createRuntimeCheckpointDelta, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN } from "../RuntimeCheckpointDeltaService";
import { loadRuntimeCheckpointWithCache } from "../RuntimeCheckpointHydrationService";

const state = (time: number, marker = "A"): SharedExerciseState => ({
  exerciseSession: { exerciseId: "EX-DELTA", lifecycleState: "COMPLETED", simulationTimeSec: time } as never,
  patients: [{ id: "PT-1", name: "Test" } as never], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [],
  notes: [{ id: "STATIC", text: marker.repeat(60_000) } as never], scenarioEvents: [], timelineEvents: [], persistedRuntimeStates: [],
});
const checkpoint = (revision: number, time = revision, marker = "A") => createRuntimeCheckpoint(state(time, marker), revision);
const metadata = (value: ReturnType<typeof checkpoint>) => ({ exerciseId: value.exerciseId, checkpointRevision: value.checkpointRevision, payloadHash: value.payloadHash, provenanceHash: value.provenanceHash, writerInstanceId: "W" });
const repository = (target: ReturnType<typeof checkpoint>, deltas: readonly ReturnType<typeof createRuntimeCheckpointDelta>[] = []) => ({
  loadLatestMetadata: jest.fn(async () => metadata(target)),
  loadDeltas: jest.fn(async () => deltas),
  loadLatest: jest.fn(async () => target),
});

describe("WP-EGRESS-03 verified checkpoint delta hydration", () => {
  beforeEach(() => { setSupabaseTrafficMetricsEnabledForTests(true); resetSupabaseTrafficMetrics(); });
  afterAll(() => setSupabaseTrafficMetricsEnabledForTests(undefined));

  test("warm restart with current durable cache performs zero full fetches", async () => {
    const current = checkpoint(4); const repo = repository(current);
    await expect(loadRuntimeCheckpointWithCache(repo as never, current.exerciseId, current, "startup")).resolves.toBe(current);
    expect(repo.loadDeltas).not.toHaveBeenCalled(); expect(repo.loadLatest).not.toHaveBeenCalled();
  });

  test("one-revision stale cache hydrates through one verified delta", async () => {
    const base = checkpoint(4); const target = checkpoint(5); const delta = createRuntimeCheckpointDelta(base, target); const repo = repository(target, [delta]);
    await expect(loadRuntimeCheckpointWithCache(repo as never, base.exerciseId, base, "realtime")).resolves.toEqual(target);
    expect(repo.loadLatest).not.toHaveBeenCalled();
  });

  test("multi-revision chain applies deterministically", async () => {
    const a = checkpoint(4), b = checkpoint(5), c = checkpoint(7);
    expect(applyRuntimeCheckpointDeltaChain(a, [createRuntimeCheckpointDelta(a, b), createRuntimeCheckpointDelta(b, c)], 7, c.payloadHash)).toEqual(c);
  });

  test.each([
    ["missing", []],
    ["duplicate", (a: ReturnType<typeof checkpoint>, b: ReturnType<typeof checkpoint>) => { const delta = createRuntimeCheckpointDelta(a, b); return [delta, delta]; }],
    ["out-of-order", (a: ReturnType<typeof checkpoint>, b: ReturnType<typeof checkpoint>, c: ReturnType<typeof checkpoint>) => [createRuntimeCheckpointDelta(b, c), createRuntimeCheckpointDelta(a, b)]],
  ])("%s delta chain falls back to full payload", async (_name, source) => {
    const a = checkpoint(1), b = checkpoint(2), c = checkpoint(3);
    const deltas = typeof source === "function" ? source(a, b, c) : source;
    const repo = repository(c, deltas);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "realtime")).resolves.toBe(c);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("wrong base and target hashes fail closed", () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    expect(() => applyRuntimeCheckpointDelta(a, { ...delta, baseHash: "WRONG" })).toThrow("CHECKPOINT_DELTA_BASE_INVALID");
    expect(() => applyRuntimeCheckpointDelta(a, { ...delta, targetHash: "WRONG" })).toThrow("CHECKPOINT_DELTA_TARGET_INVALID");
  });

  test("persisted Runtime schema change rejects delta hydration and uses the full fallback", async () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    const incompatible = { ...delta, targetPersistedRuntimeVersion: a.persistedRuntimeVersion + 1 };
    const repo = repository(b, [incompatible]);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "startup")).resolves.toBe(b);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("malformed delta operation falls back", async () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    const malformed = { ...delta, operations: [{ type: "APPEND", path: ["missing"], values: [1] }] } as never;
    const repo = repository(b, [malformed]);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "realtime")).resolves.toBe(b);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("excessive chain length falls back", async () => {
    const values = Array.from({ length: MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN + 2 }, (_, index) => checkpoint(index + 1));
    const deltas = values.slice(1).map((value, index) => createRuntimeCheckpointDelta(values[index], value));
    const repo = repository(values.at(-1)!, deltas);
    await expect(loadRuntimeCheckpointWithCache(repo as never, values[0].exerciseId, values[0], "realtime")).resolves.toBe(values.at(-1));
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("cold start and old checkpoint without delta metadata use full fallback", async () => {
    const target = checkpoint(3); const repo = repository(target);
    await expect(loadRuntimeCheckpointWithCache(repo as never, target.exerciseId, undefined, "startup")).resolves.toBe(target);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("deterministic cache and delta byte profile", () => {
    const base = checkpoint(10), target = checkpoint(11); const delta = createRuntimeCheckpointDelta(base, target);
    const fullBytes = JSON.stringify({ payload: target }).length;
    const metadataBytes = JSON.stringify(metadata(target)).length;
    const deltaBytes = JSON.stringify({ delta_payload: delta }).length;
    const warmReduction = Number((((fullBytes - metadataBytes) / fullBytes) * 100).toFixed(1));
    const deltaReduction = Number((((fullBytes - metadataBytes - deltaBytes) / fullBytes) * 100).toFixed(1));
    console.info("WP_EGRESS_03_PROFILE", JSON.stringify({ fullBytes, metadataBytes, deltaBytes, warmReduction, deltaReduction }));
    expect(warmReduction).toBeGreaterThan(99); expect(deltaReduction).toBeGreaterThan(95);
    expect(getSupabaseTrafficMetrics()).toBeDefined();
  });
});
