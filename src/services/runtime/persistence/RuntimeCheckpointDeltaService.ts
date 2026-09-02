import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { isValidRuntimeCheckpoint, isValidRuntimeCheckpointAsync } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { stableJson } from "@/utils/stableJson";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

export const RUNTIME_CHECKPOINT_DELTA_VERSION = 1 as const;
export const MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN = 8;

type JsonPath = readonly (string | number)[];
export type RuntimeCheckpointDeltaOperation = Readonly<
  | { type: "SET"; path: JsonPath; value: unknown }
  | { type: "DELETE"; path: JsonPath }
  | { type: "APPEND"; path: JsonPath; values: readonly unknown[] }
>;

export type RuntimeCheckpointDelta = Readonly<{
  deltaVersion: typeof RUNTIME_CHECKPOINT_DELTA_VERSION;
  exerciseId: string;
  fromRevision: number;
  toRevision: number;
  baseHash: string;
  targetHash: string;
  targetProvenanceHash: string;
  targetPersistedRuntimeVersion: number;
  operations: readonly RuntimeCheckpointDeltaOperation[];
}>;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const same = (left: unknown, right: unknown): boolean => {
  return stableJson(left) === stableJson(right);
}

function changes(previous: unknown, next: unknown, path: JsonPath, output: RuntimeCheckpointDeltaOperation[]): void {
  if (same(previous, next)) return;
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (next.length >= previous.length && previous.every((value, index) => same(value, next[index]))) {
      if (next.length > previous.length) output.push({ type: "APPEND", path, values: structuredClone(next.slice(previous.length)) });
      return;
    }
    if (previous.length === next.length) {
      previous.forEach((value, index) => changes(value, next[index], [...path, index], output));
      return;
    }
  }
  if (object(previous) && object(next)) {
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
    keys.forEach(key => {
      if (!(key in next)) output.push({ type: "DELETE", path: [...path, key] });
      else if (!(key in previous)) output.push({ type: "SET", path: [...path, key], value: structuredClone(next[key]) });
      else changes(previous[key], next[key], [...path, key], output);
    });
    return;
  }
  output.push({ type: "SET", path, value: structuredClone(next) });
}

export function createRuntimeCheckpointDelta(
  base: RuntimeCheckpointEnvelope<SharedExerciseState>,
  target: RuntimeCheckpointEnvelope<SharedExerciseState>,
): RuntimeCheckpointDelta {
  if (!isValidRuntimeCheckpoint(base) || !isValidRuntimeCheckpoint(target) || base.exerciseId !== target.exerciseId || target.checkpointRevision <= base.checkpointRevision) {
    throw new Error("CHECKPOINT_DELTA_BASE_INVALID");
  }
  const operations: RuntimeCheckpointDeltaOperation[] = [];
  changes(base.payload, target.payload, [], operations);
  return Object.freeze({
    deltaVersion: RUNTIME_CHECKPOINT_DELTA_VERSION,
    exerciseId: target.exerciseId,
    fromRevision: base.checkpointRevision,
    toRevision: target.checkpointRevision,
    baseHash: base.payloadHash,
    targetHash: target.payloadHash,
    targetProvenanceHash: target.provenanceHash,
    targetPersistedRuntimeVersion: target.persistedRuntimeVersion,
    operations: Object.freeze(operations),
  });
}

export type RuntimeCheckpointDeltaBuildOptions = Readonly<{
  yieldControl: PipelineYield;
  shouldContinue?: () => boolean;
  maxSliceMs?: number;
  nodesPerSlice?: number;
}>;

export class RuntimeCheckpointDeltaBuildCancelledError extends Error {
  constructor() { super("GENERATION_STOPPED"); this.name = "RuntimeCheckpointDeltaBuildCancelledError"; }
}

type CooperativeDeltaMetrics = {
  comparisons: number;
  nodesVisited: number;
  yieldCount: number;
  maxBatchDurationMs: number;
  cloneNodes: number;
};

type JsonFrame = Readonly<{ left: unknown; right: unknown }>;

function unsupported(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/**
 * Canonical-JSON equality without allocating two multi-megabyte strings.
 * It follows stableJson's JSON semantics (omitted object values, null array
 * slots, sorted object keys) and yields inside the actual traversal work.
 */
async function sameCooperatively(
  left: unknown,
  right: unknown,
  options: RuntimeCheckpointDeltaBuildOptions,
  metrics: CooperativeDeltaMetrics,
): Promise<boolean> {
  const stack: JsonFrame[] = [{ left, right }];
  const maxSliceMs = options.maxSliceMs ?? 16;
  const nodesPerSlice = options.nodesPerSlice ?? 512;
  let sliceStarted = performance.now();
  let nodesInSlice = 0;
  while (stack.length) {
    if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
    const frame = stack.pop()!;
    metrics.nodesVisited += 1;
    nodesInSlice += 1;
    const leftUnsupported = unsupported(frame.left);
    const rightUnsupported = unsupported(frame.right);
    if (leftUnsupported || rightUnsupported) {
      if (!(leftUnsupported && rightUnsupported)) return false;
    } else if (frame.left === null || frame.right === null || typeof frame.left !== "object" || typeof frame.right !== "object") {
      if (JSON.stringify(frame.left) !== JSON.stringify(frame.right)) return false;
    } else if (Array.isArray(frame.left) || Array.isArray(frame.right)) {
      if (!Array.isArray(frame.left) || !Array.isArray(frame.right) || frame.left.length !== frame.right.length) return false;
      for (let index = frame.left.length - 1; index >= 0; index -= 1) {
        const nextLeft = unsupported(frame.left[index]) ? null : frame.left[index];
        const nextRight = unsupported(frame.right[index]) ? null : frame.right[index];
        stack.push({ left: nextLeft, right: nextRight });
      }
    } else {
      const leftRecord = frame.left as Record<string, unknown>;
      const rightRecord = frame.right as Record<string, unknown>;
      const leftKeys = Object.keys(leftRecord).filter(key => !unsupported(leftRecord[key])).sort((a, b) => a.localeCompare(b));
      const rightKeys = Object.keys(rightRecord).filter(key => !unsupported(rightRecord[key])).sort((a, b) => a.localeCompare(b));
      if (leftKeys.length !== rightKeys.length) return false;
      for (let index = leftKeys.length - 1; index >= 0; index -= 1) {
        if (leftKeys[index] !== rightKeys[index]) return false;
        stack.push({ left: leftRecord[leftKeys[index]], right: rightRecord[rightKeys[index]] });
      }
    }
    if (nodesInSlice >= nodesPerSlice || performance.now() - sliceStarted >= maxSliceMs) {
      const durationMs = performance.now() - sliceStarted;
      metrics.maxBatchDurationMs = Math.max(metrics.maxBatchDurationMs, durationMs);
      await options.yieldControl();
      metrics.yieldCount += 1;
      if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
      sliceStarted = performance.now(); nodesInSlice = 0;
    }
  }
  metrics.maxBatchDurationMs = Math.max(metrics.maxBatchDurationMs, performance.now() - sliceStarted);
  return true;
}

async function cloneCooperatively<T>(
  source: T,
  options: RuntimeCheckpointDeltaBuildOptions,
  metrics: CooperativeDeltaMetrics,
): Promise<T> {
  if (source === null || typeof source !== "object") return source;
  const root: unknown = Array.isArray(source) ? [] : {};
  const stack: { source: Record<string | number, unknown> | unknown[]; target: Record<string | number, unknown> | unknown[]; keys: (string | number)[]; index: number }[] = [{
    source: source as Record<string | number, unknown> | unknown[], target: root as Record<string | number, unknown> | unknown[],
    keys: Array.isArray(source) ? source.map((_value, index) => index) : Object.keys(source as Record<string, unknown>), index: 0,
  }];
  let sliceStarted = performance.now(); let nodesInSlice = 0;
  while (stack.length) {
    if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.keys.length) { stack.pop(); continue; }
    const key = frame.keys[frame.index++];
    const value = frame.source[key as never];
    metrics.cloneNodes += 1; nodesInSlice += 1;
    if (value !== null && typeof value === "object") {
      const nested: unknown = Array.isArray(value) ? [] : {};
      frame.target[key as never] = nested as never;
      stack.push({ source: value as Record<string | number, unknown> | unknown[], target: nested as Record<string | number, unknown> | unknown[], keys: Array.isArray(value) ? value.map((_item, index) => index) : Object.keys(value as Record<string, unknown>), index: 0 });
    } else frame.target[key as never] = value as never;
    if (nodesInSlice >= (options.nodesPerSlice ?? 512) || performance.now() - sliceStarted >= (options.maxSliceMs ?? 16)) {
      const durationMs = performance.now() - sliceStarted;
      metrics.maxBatchDurationMs = Math.max(metrics.maxBatchDurationMs, durationMs);
      await options.yieldControl(); metrics.yieldCount += 1;
      if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
      sliceStarted = performance.now(); nodesInSlice = 0;
    }
  }
  metrics.maxBatchDurationMs = Math.max(metrics.maxBatchDurationMs, performance.now() - sliceStarted);
  return root as T;
}

async function changesCooperatively(
  previous: unknown,
  next: unknown,
  path: JsonPath,
  output: RuntimeCheckpointDeltaOperation[],
  options: RuntimeCheckpointDeltaBuildOptions,
  metrics: CooperativeDeltaMetrics,
): Promise<void> {
  metrics.comparisons += 1;
  if (await sameCooperatively(previous, next, options, metrics)) return;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let prefix = next.length >= previous.length;
    for (let index = 0; prefix && index < previous.length; index += 1) {
      metrics.comparisons += 1;
      prefix = await sameCooperatively(previous[index], next[index], options, metrics);
    }
    if (prefix) {
      if (next.length > previous.length) output.push({ type: "APPEND", path, values: await cloneCooperatively(next.slice(previous.length), options, metrics) });
      return;
    }
    if (previous.length === next.length) {
      for (let index = 0; index < previous.length; index += 1) await changesCooperatively(previous[index], next[index], [...path, index], output, options, metrics);
      return;
    }
  }
  if (object(previous) && object(next)) {
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
    for (const key of keys) {
      if (!(key in next)) output.push({ type: "DELETE", path: [...path, key] });
      else if (!(key in previous)) output.push({ type: "SET", path: [...path, key], value: await cloneCooperatively(next[key], options, metrics) });
      else await changesCooperatively(previous[key], next[key], [...path, key], output, options, metrics);
    }
    return;
  }
  output.push({ type: "SET", path, value: await cloneCooperatively(next, options, metrics) });
}

export async function createRuntimeCheckpointDeltaAsync(
  base: RuntimeCheckpointEnvelope<SharedExerciseState>,
  target: RuntimeCheckpointEnvelope<SharedExerciseState>,
  options: RuntimeCheckpointDeltaBuildOptions,
): Promise<RuntimeCheckpointDelta> {
  const metrics: CooperativeDeltaMetrics = { comparisons: 0, nodesVisited: 0, yieldCount: 0, maxBatchDurationMs: 0, cloneNodes: 0 };
  const endBuild = startRuntimeWorkTrace("REMOTE_PUB_DELTA_BUILD", { fromRevision: base.checkpointRevision, toRevision: target.checkpointRevision });
  const checkedYield: PipelineYield = async () => {
    if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
    await options.yieldControl();
    if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
  };
  const baseValid = await isValidRuntimeCheckpointAsync(base, checkedYield);
  const targetValid = await isValidRuntimeCheckpointAsync(target, checkedYield);
  if (!baseValid || !targetValid || base.exerciseId !== target.exerciseId || target.checkpointRevision <= base.checkpointRevision) throw new Error("CHECKPOINT_DELTA_BASE_INVALID");
  const operations: RuntimeCheckpointDeltaOperation[] = [];
  await changesCooperatively(base.payload, target.payload, [], operations, { ...options, yieldControl: checkedYield }, metrics);
  if (options.shouldContinue?.() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
  endBuild({ operationCount: operations.length, ...metrics });
  return Object.freeze({
    deltaVersion: RUNTIME_CHECKPOINT_DELTA_VERSION, exerciseId: target.exerciseId,
    fromRevision: base.checkpointRevision, toRevision: target.checkpointRevision,
    baseHash: base.payloadHash, targetHash: target.payloadHash,
    targetProvenanceHash: target.provenanceHash, targetPersistedRuntimeVersion: target.persistedRuntimeVersion,
    operations: Object.freeze(operations),
  });
}

function parentAt(root: unknown, path: JsonPath): { parent: Record<string | number, unknown> | unknown[]; key: string | number } {
  if (!path.length) throw new Error("CHECKPOINT_DELTA_PATH_INVALID");
  let current = root as Record<string | number, unknown> | unknown[];
  for (const segment of path.slice(0, -1)) {
    const next = current[segment as never];
    if (!next || typeof next !== "object") throw new Error("CHECKPOINT_DELTA_PATH_INVALID");
    current = next as Record<string | number, unknown> | unknown[];
  }
  return { parent: current, key: path[path.length - 1] };
}

function applyOperation(root: unknown, operation: RuntimeCheckpointDeltaOperation): unknown {
  if (!operation.path.length) {
    if (operation.type !== "SET") throw new Error("CHECKPOINT_DELTA_PATH_INVALID");
    return structuredClone(operation.value);
  }
  const { parent, key } = parentAt(root, operation.path);
  if (operation.type === "SET") parent[key as never] = structuredClone(operation.value) as never;
  else if (operation.type === "DELETE") {
    if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
    else delete parent[key as never];
  } else {
    const target = parent[key as never];
    if (!Array.isArray(target)) throw new Error("CHECKPOINT_DELTA_PATH_INVALID");
    target.push(...structuredClone(operation.values));
  }
  return root;
}

export function applyRuntimeCheckpointDelta(
  base: RuntimeCheckpointEnvelope<SharedExerciseState>,
  delta: RuntimeCheckpointDelta,
): RuntimeCheckpointEnvelope<SharedExerciseState> {
  if (!isValidRuntimeCheckpoint(base) || delta.deltaVersion !== RUNTIME_CHECKPOINT_DELTA_VERSION ||
    delta.exerciseId !== base.exerciseId || delta.fromRevision !== base.checkpointRevision || delta.baseHash !== base.payloadHash ||
    delta.targetPersistedRuntimeVersion !== base.persistedRuntimeVersion ||
    !Number.isSafeInteger(delta.toRevision) || delta.toRevision <= delta.fromRevision) throw new Error("CHECKPOINT_DELTA_BASE_INVALID");
  let payload: unknown = structuredClone(base.payload);
  delta.operations.forEach(operation => { payload = applyOperation(payload, operation); });
  const reconstructed = {
    envelopeVersion: base.envelopeVersion,
    exerciseId: delta.exerciseId,
    checkpointRevision: delta.toRevision,
    persistedRuntimeVersion: delta.targetPersistedRuntimeVersion,
    payload: payload as SharedExerciseState,
    payloadHash: delta.targetHash,
    provenanceHash: delta.targetProvenanceHash,
  } satisfies RuntimeCheckpointEnvelope<SharedExerciseState>;
  if (!isValidRuntimeCheckpoint(reconstructed)) throw new Error("CHECKPOINT_DELTA_TARGET_INVALID");
  return reconstructed;
}

export function applyRuntimeCheckpointDeltaChain(
  base: RuntimeCheckpointEnvelope<SharedExerciseState>,
  deltas: readonly RuntimeCheckpointDelta[],
  targetRevision: number,
  targetHash: string,
): RuntimeCheckpointEnvelope<SharedExerciseState> {
  if (!deltas.length || deltas.length > MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN) throw new Error("CHECKPOINT_DELTA_CHAIN_UNAVAILABLE");
  let current = base;
  for (const delta of deltas) current = applyRuntimeCheckpointDelta(current, delta);
  if (current.checkpointRevision !== targetRevision || current.payloadHash !== targetHash) throw new Error("CHECKPOINT_DELTA_TARGET_INVALID");
  return current;
}
