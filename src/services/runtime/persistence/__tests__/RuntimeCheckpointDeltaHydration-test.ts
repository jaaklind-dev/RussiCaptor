import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getSupabaseTrafficMetrics, resetSupabaseTrafficMetrics, setSupabaseTrafficMetricsEnabledForTests } from "@/services/SupabaseTrafficMetrics";
import { createRuntimeCheckpoint } from "../RuntimeCheckpointAuthorityService";
import { applyRuntimeCheckpointDelta, applyRuntimeCheckpointDeltaChain, createRuntimeCheckpointDelta, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN } from "../RuntimeCheckpointDeltaService";
import { loadRuntimeCheckpointWithCache, RUNTIME_CHECKPOINT_DELTA_COST_RATIO } from "../RuntimeCheckpointHydrationService";

const state = (time: number, marker = "A", markerSize = 60_000): SharedExerciseState => ({
  exerciseSession: { exerciseId: "EX-DELTA", lifecycleState: "COMPLETED", simulationTimeSec: time } as never,
  patients: [{ id: "PT-1", name: "Test" } as never], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [],
  notes: [{ id: "STATIC", text: marker.repeat(markerSize) } as never], scenarioEvents: [], timelineEvents: [], persistedRuntimeStates: [],
});
const checkpoint = (revision: number, time = revision, marker = "A", markerSize = 60_000) => createRuntimeCheckpoint(state(time, marker, markerSize), revision);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const metadata = (value: ReturnType<typeof checkpoint>, checkpointBytes = bytes(value)) => ({ exerciseId: value.exerciseId, checkpointRevision: value.checkpointRevision, payloadHash: value.payloadHash, provenanceHash: value.provenanceHash, writerInstanceId: "W", checkpointBytes });
const cost = (delta: ReturnType<typeof createRuntimeCheckpointDelta>, payloadBytes = bytes(delta)) => ({
  fromRevision: delta.fromRevision, toRevision: delta.toRevision, baseHash: delta.baseHash, targetHash: delta.targetHash,
  provenanceHash: delta.targetProvenanceHash, deltaVersion: delta.deltaVersion,
  persistedRuntimeVersion: delta.targetPersistedRuntimeVersion, payloadBytes,
});
const repository = (target: ReturnType<typeof checkpoint>, deltas: readonly ReturnType<typeof createRuntimeCheckpointDelta>[] = [], checkpointBytes = bytes(target)) => ({
  loadLatestMetadata: jest.fn(async () => metadata(target, checkpointBytes)),
  loadDeltaMetadata: jest.fn(async () => deltas.map(delta => cost(delta))),
  loadDeltas: jest.fn(async () => deltas),
  loadLatest: jest.fn(async () => target),
});

describe("WP-EGRESS-03 verified checkpoint delta hydration", () => {
  beforeEach(() => { setSupabaseTrafficMetricsEnabledForTests(true); resetSupabaseTrafficMetrics(); });
  afterAll(() => setSupabaseTrafficMetricsEnabledForTests(undefined));

  test("warm restart with current durable cache performs zero full fetches", async () => {
    const current = checkpoint(4); const repo = repository(current);
    await expect(loadRuntimeCheckpointWithCache(repo as never, current.exerciseId, current, "startup")).resolves.toBe(current);
    expect(repo.loadDeltaMetadata).not.toHaveBeenCalled(); expect(repo.loadDeltas).not.toHaveBeenCalled(); expect(repo.loadLatest).not.toHaveBeenCalled();
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

  test("cost metadata selects a cheap multi-delta chain before payload download", async () => {
    const a = checkpoint(1), b = checkpoint(2), c = checkpoint(3);
    const deltas = [createRuntimeCheckpointDelta(a, b), createRuntimeCheckpointDelta(b, c)];
    const repo = repository(c, deltas, 1_000_000);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "realtime")).resolves.toEqual(c);
    expect(repo.loadDeltaMetadata.mock.invocationCallOrder[0]).toBeLessThan(repo.loadDeltas.mock.invocationCallOrder[0]);
    expect(repo.loadLatest).not.toHaveBeenCalled();
  });

  test("expensive chain is rejected before delta payload and full checkpoint is fetched exactly once", async () => {
    const a = checkpoint(1), b = checkpoint(2), c = checkpoint(3);
    const deltas = [createRuntimeCheckpointDelta(a, b), createRuntimeCheckpointDelta(b, c)];
    const repo = repository(c, deltas, 700_000);
    repo.loadDeltaMetadata.mockResolvedValue(deltas.map(delta => cost(delta, 450_000)));
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "takeover")).resolves.toBe(c);
    expect(repo.loadDeltas).not.toHaveBeenCalled();
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
    expect(getSupabaseTrafficMetrics()).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "FULL_SELECTED_BY_COST" })]));
  });

  test("ratio boundary is deterministic: equal budget selects delta and one byte above selects full", async () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    const fullBytes = 1_000_000; const boundary = Math.floor(fullBytes * RUNTIME_CHECKPOINT_DELTA_COST_RATIO);
    const selected = repository(b, [delta], fullBytes); selected.loadDeltaMetadata.mockResolvedValue([cost(delta, boundary)]);
    await loadRuntimeCheckpointWithCache(selected as never, a.exerciseId, a, "realtime");
    expect(selected.loadDeltas).toHaveBeenCalledTimes(1); expect(selected.loadLatest).not.toHaveBeenCalled();
    const rejected = repository(b, [delta], fullBytes); rejected.loadDeltaMetadata.mockResolvedValue([cost(delta, boundary + 1)]);
    await loadRuntimeCheckpointWithCache(rejected as never, a.exerciseId, a, "realtime");
    expect(rejected.loadDeltas).not.toHaveBeenCalled(); expect(rejected.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("missing full or delta byte metadata uses conservative full fallback", async () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    const missingFull = repository(b, [delta]); const { checkpointBytes: _omitted, ...legacyMetadata } = metadata(b);
    missingFull.loadLatestMetadata.mockResolvedValue(legacyMetadata as ReturnType<typeof metadata>);
    await loadRuntimeCheckpointWithCache(missingFull as never, a.exerciseId, a, "startup");
    expect(missingFull.loadDeltaMetadata).not.toHaveBeenCalled(); expect(missingFull.loadLatest).toHaveBeenCalledTimes(1);
    const missingDelta = repository(b, [delta]); missingDelta.loadDeltaMetadata.mockResolvedValue([{ ...cost(delta), payloadBytes: Number.NaN }]);
    await loadRuntimeCheckpointWithCache(missingDelta as never, a.exerciseId, a, "startup");
    expect(missingDelta.loadDeltas).not.toHaveBeenCalled(); expect(missingDelta.loadLatest).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["missing", []],
    ["duplicate", (a: ReturnType<typeof checkpoint>, b: ReturnType<typeof checkpoint>) => { const delta = createRuntimeCheckpointDelta(a, b); return [delta, delta]; }],
    ["out-of-order", (a: ReturnType<typeof checkpoint>, b: ReturnType<typeof checkpoint>, c: ReturnType<typeof checkpoint>) => [createRuntimeCheckpointDelta(b, c), createRuntimeCheckpointDelta(a, b)]],
  ])("%s delta chain falls back to full payload", async (_name, source) => {
    const a = checkpoint(1), b = checkpoint(2), c = checkpoint(3);
    const deltas = typeof source === "function" ? source(a, b, c) : source;
    const repo = repository(c, deltas, 10_000_000);
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
    const repo = repository(b, [incompatible], 10_000_000);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "startup")).resolves.toBe(b);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("malformed delta operation falls back", async () => {
    const a = checkpoint(1), b = checkpoint(2); const delta = createRuntimeCheckpointDelta(a, b);
    const malformed = { ...delta, operations: [{ type: "APPEND", path: ["missing"], values: [1] }] } as never;
    const repo = repository(b, [malformed], 10_000_000);
    await expect(loadRuntimeCheckpointWithCache(repo as never, a.exerciseId, a, "realtime")).resolves.toBe(b);
    expect(repo.loadLatest).toHaveBeenCalledTimes(1);
  });

  test("excessive chain length falls back", async () => {
    const values = Array.from({ length: MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN + 2 }, (_, index) => checkpoint(index + 1));
    const deltas = values.slice(1).map((value, index) => createRuntimeCheckpointDelta(values[index], value));
    const repo = repository(values.at(-1)!, deltas, 100_000_000);
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

  test("deterministic cheap, expensive and borderline byte-budget evidence", async () => {
    const cheapBase = checkpoint(20, 20, "A", 1_000_000), cheapTarget = checkpoint(21, 21, "A", 1_000_000);
    const cheapDelta = createRuntimeCheckpointDelta(cheapBase, cheapTarget);
    const cheapFullBytes = bytes(cheapTarget), cheapDeltaBytes = bytes(cheapDelta);
    const cheapRepo = repository(cheapTarget, [cheapDelta], cheapFullBytes);
    await loadRuntimeCheckpointWithCache(cheapRepo as never, cheapBase.exerciseId, cheapBase, "realtime");
    expect(cheapRepo.loadDeltas).toHaveBeenCalledTimes(1);

    const expensiveBase = checkpoint(30, 30, "A", 700_000), expensiveMiddle = checkpoint(31, 31, "B", 700_000);
    const expensiveTarget = checkpoint(32, 32, "C", 700_000);
    const expensiveDeltas = [createRuntimeCheckpointDelta(expensiveBase, expensiveMiddle), createRuntimeCheckpointDelta(expensiveMiddle, expensiveTarget)];
    const expensiveFullBytes = bytes(expensiveTarget);
    const expensiveDeltaBytes = expensiveDeltas.reduce((sum, delta) => sum + bytes(delta), 0);
    const expensiveRepo = repository(expensiveTarget, expensiveDeltas, expensiveFullBytes);
    await loadRuntimeCheckpointWithCache(expensiveRepo as never, expensiveBase.exerciseId, expensiveBase, "realtime");
    expect(expensiveDeltaBytes).toBeGreaterThan(expensiveFullBytes);
    expect(expensiveRepo.loadDeltas).not.toHaveBeenCalled(); expect(expensiveRepo.loadLatest).toHaveBeenCalledTimes(1);

    const borderlineFullBytes = 1_000_000;
    const borderlineBytes = Math.floor(borderlineFullBytes * RUNTIME_CHECKPOINT_DELTA_COST_RATIO);
    console.info("WP_EGRESS_04_PROFILE", JSON.stringify({
      cheap:{fullCheckpointBytes:cheapFullBytes,candidateDeltaBytes:cheapDeltaBytes,path:"DELTA",actualHydrationBytes:cheapDeltaBytes,avoidedBytes:cheapFullBytes-cheapDeltaBytes,reductionPercent:Number(((1-cheapDeltaBytes/cheapFullBytes)*100).toFixed(1))},
      expensive:{fullCheckpointBytes:expensiveFullBytes,candidateDeltaBytes:expensiveDeltaBytes,path:"FULL",actualHydrationBytes:expensiveFullBytes,avoidedBytes:expensiveDeltaBytes-expensiveFullBytes},
      borderline:{fullCheckpointBytes:borderlineFullBytes,candidateDeltaBytes:borderlineBytes,path:"DELTA_AT_EQUAL_RATIO"},
    }));
  });
});
