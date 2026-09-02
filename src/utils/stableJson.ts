import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export type StableJsonAsyncOptions = Readonly<{
  /** Validation-only opaque category; never serialized into checkpoint data. */
  traceCategory?: "RUNTIME_PAYLOAD" | "FULL_CHECKPOINT" | "DELTA" | "OTHER";
  yieldEvery?: number;
  /** Maximum continuous JavaScript work before yielding, when configured. */
  maxSliceMs?: number;
  yieldControl?: () => Promise<void>;
  onSlice?: (durationMs: number) => void;
}>;

/**
 * Byte-equivalent yielding form of stableJson. It emits canonical JSON
 * directly instead of allocating a second canonical object tree. Work is
 * sliced by visited values; the final string remains identical to the legacy
 * canonicalize + JSON.stringify contract.
 */
export async function stableJsonAsync(
  value: unknown,
  options: StableJsonAsyncOptions = {},
): Promise<string> {
  const category = options.traceCategory ?? "OTHER";
  const endBuild = startRuntimeWorkTrace("STABLE_JSON_BUILD", { category });
  const chunks: string[] = [];
  let totalChunkCharacters = 0;
  let maxChunkCharacters = 0;
  const pushChunk = (chunk: string): void => {
    chunks.push(chunk);
    chunkPushesSinceYield += 1;
    totalChunkCharacters += chunk.length;
    maxChunkCharacters = Math.max(maxChunkCharacters, chunk.length);
  };
  const yieldEvery = Math.max(1, options.yieldEvery ?? 4_096);
  const maxSliceMs = options.maxSliceMs;
  const yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  let visited = 0;
  let sliceStarted = performance.now();
  let yieldCount = 0;
  let maxBatchDurationMs = 0;
  let maxNodesBetweenYields = 0;
  let nodesAtLastYield = 0;
  let objectCount = 0;
  let arrayCount = 0;
  let scalarCount = 0;
  let stringCount = 0;
  let totalKeys = 0;
  let maxObjectKeys = 0;
  let maxObjectKeysDurationMs = 0;
  let maxKeySortDurationMs = 0;
  let sortCount = 0;
  let maxArrayLength = 0;
  let maxArrayTraversalDurationMs = 0;
  let appendCalls = 0;
  let maxRecursionDepth = 0;
  let maxChunkPushBurst = 0;
  let chunkPushesSinceYield = 0;
  let batchId = 0;

  const finishBatch = (durationMs: number): void => {
    const nodesInBatch = visited - nodesAtLastYield;
    maxBatchDurationMs = Math.max(maxBatchDurationMs, durationMs);
    maxNodesBetweenYields = Math.max(maxNodesBetweenYields, nodesInBatch);
    maxChunkPushBurst = Math.max(maxChunkPushBurst, chunkPushesSinceYield);
    if (durationMs >= 250) {
      const endBatch = startRuntimeWorkTrace("STABLE_JSON_TRAVERSAL_BATCH", {
        category,
        batchId,
        nodesInBatch,
        chunkPushes: chunkPushesSinceYield,
      });
      endBatch({ durationMs });
    }
  };

  const checkpoint = async (): Promise<void> => {
    visited += 1;
    if (visited % yieldEvery !== 0 ||
      (maxSliceMs !== undefined && performance.now() - sliceStarted < maxSliceMs)) return;
    const durationMs = performance.now() - sliceStarted;
    finishBatch(durationMs);
    options.onSlice?.(durationMs);
    await yieldControl();
    yieldCount += 1;
    nodesAtLastYield = visited;
    chunkPushesSinceYield = 0;
    batchId += 1;
    sliceStarted = performance.now();
  };

  const append = async (current: unknown, inArray: boolean, depth = 0): Promise<boolean> => {
    appendCalls += 1;
    maxRecursionDepth = Math.max(maxRecursionDepth, depth);
    await checkpoint();
    if (current === undefined || typeof current === "function" || typeof current === "symbol") {
      if (inArray) pushChunk("null");
      return inArray;
    }
    if (current === null || typeof current !== "object") {
      scalarCount += 1;
      if (typeof current === "string") stringCount += 1;
      const serialized = JSON.stringify(current);
      if (serialized === undefined) {
        if (inArray) pushChunk("null");
        return inArray;
      }
      pushChunk(serialized);
      return true;
    }
    if (Array.isArray(current)) {
      arrayCount += 1;
      maxArrayLength = Math.max(maxArrayLength, current.length);
      const arrayStarted = performance.now();
      pushChunk("[");
      for (let index = 0; index < current.length; index += 1) {
        if (index) pushChunk(",");
        await append(current[index], true, depth + 1);
      }
      pushChunk("]");
      maxArrayTraversalDurationMs = Math.max(maxArrayTraversalDurationMs, performance.now() - arrayStarted);
      return true;
    }
    objectCount += 1;
    pushChunk("{");
    let emitted = 0;
    const record = current as Record<string, unknown>;
    const keysStarted = performance.now();
    const keys = Object.keys(record);
    maxObjectKeys = Math.max(maxObjectKeys, keys.length);
    totalKeys += keys.length;
    const keysDurationMs = performance.now() - keysStarted;
    maxObjectKeysDurationMs = Math.max(maxObjectKeysDurationMs, keysDurationMs);
    const sortStarted = performance.now();
    keys.sort((left, right) => left.localeCompare(right));
    const sortDurationMs = performance.now() - sortStarted;
    sortCount += 1;
    maxKeySortDurationMs = Math.max(maxKeySortDurationMs, sortDurationMs);
    if (keys.length >= 1_000 || sortDurationMs >= 50 || keysDurationMs >= 50) {
      const endObjectKeys = startRuntimeWorkTrace("STABLE_JSON_OBJECT_KEYS", {
        category,
        keyCount: keys.length,
      });
      endObjectKeys({ keysDurationMs, sortDurationMs });
    }
    for (const key of keys) {
      const nested = record[key];
      if (nested === undefined || typeof nested === "function" || typeof nested === "symbol") continue;
      if (emitted) pushChunk(",");
      pushChunk(JSON.stringify(key)); pushChunk(":");
      await append(nested, false, depth + 1);
      emitted += 1;
    }
    pushChunk("}");
    return true;
  };

  await append(value, false);
  const finalBatchDurationMs = performance.now() - sliceStarted;
  finishBatch(finalBatchDurationMs);
  options.onSlice?.(finalBatchDurationMs);
  await yieldControl();
  endBuild({
    category,
    nodesVisited: visited,
    appendCalls,
    objectCount,
    arrayCount,
    scalarCount,
    stringCount,
    totalKeys,
    maxObjectKeys,
    maxObjectKeysDurationMs,
    maxKeySortDurationMs,
    sortCount,
    maxArrayLength,
    maxArrayTraversalDurationMs,
    maxRecursionDepth,
    yieldCount,
    maxBatchDurationMs,
    maxNodesBetweenYields,
    maxChunkPushBurst,
    chunkCount: chunks.length,
    totalChunkCharacters,
    maxChunkCharacters,
  });
  const endJoin = startRuntimeWorkTrace("STABLE_JSON_JOIN", { category, chunkCount: chunks.length, totalChunkCharacters, maxChunkCharacters });
  const result = chunks.join("");
  endJoin({ category, outputBytes: result.length });
  return result;
}
