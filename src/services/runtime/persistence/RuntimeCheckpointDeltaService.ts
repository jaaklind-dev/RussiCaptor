import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { isValidRuntimeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { stableJson } from "@/utils/stableJson";

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

const same = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
