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

type StableJsonWorkItem =
  | Readonly<{ kind: "VALUE"; value: unknown; inArray: boolean; depth: number }>
  | Readonly<{ kind: "CHUNK"; value: string }>;

let stableJsonAsyncInvocation = 0;

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
  stableJsonAsyncInvocation += 1;
  const invocation = stableJsonAsyncInvocation;
  const endBuild = startRuntimeWorkTrace("STABLE_JSON_BUILD", { category, invocation });
  const chunks: string[] = [];
  let sliceChunks: string[] = [];
  let totalChunkCharacters = 0;
  let maxChunkCharacters = 0;
  let tokenCount = 0;
  const pushChunk = (chunk: string): void => {
    sliceChunks.push(chunk);
    tokenCount += 1;
    chunkPushesSinceYield += 1;
    totalChunkCharacters += chunk.length;
    maxChunkCharacters = Math.max(maxChunkCharacters, chunk.length);
  };
  const flushChunks = (): void => {
    if (!sliceChunks.length) return;
    chunks.push(sliceChunks.join(""));
    sliceChunks = [];
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

  // A recursive async serializer creates one Promise and continuation per
  // value. Hermes amplifies that overhead dramatically for large checkpoint
  // event arrays. This explicit work stack performs the same traversal while
  // crossing an async boundary only at cooperative slice boundaries.
  const work: StableJsonWorkItem[] = [{ kind: "VALUE", value, inArray: false, depth: 0 }];
  while (work.length) {
    const item = work.pop()!;
    if (item.kind === "CHUNK") {
      pushChunk(item.value);
      continue;
    }
    const current = item.value;
    appendCalls += 1;
    maxRecursionDepth = Math.max(maxRecursionDepth, item.depth);
    visited += 1;
    if (visited % yieldEvery === 0 &&
      (maxSliceMs === undefined || performance.now() - sliceStarted >= maxSliceMs)) {
      const durationMs = performance.now() - sliceStarted;
      finishBatch(durationMs);
      flushChunks();
      options.onSlice?.(durationMs);
      await yieldControl();
      yieldCount += 1;
      nodesAtLastYield = visited;
      chunkPushesSinceYield = 0;
      batchId += 1;
      sliceStarted = performance.now();
    }
    if (current === undefined || typeof current === "function" || typeof current === "symbol") {
      if (item.inArray) pushChunk("null");
      continue;
    }
    if (current === null || typeof current !== "object") {
      scalarCount += 1;
      if (typeof current === "string") stringCount += 1;
      const serialized = JSON.stringify(current);
      if (serialized !== undefined) pushChunk(serialized);
      else if (item.inArray) pushChunk("null");
      continue;
    }
    if (Array.isArray(current)) {
      arrayCount += 1;
      maxArrayLength = Math.max(maxArrayLength, current.length);
      const arrayStarted = performance.now();
      work.push({ kind: "CHUNK", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        work.push({ kind: "VALUE", value: current[index], inArray: true, depth: item.depth + 1 });
        if (index > 0) work.push({ kind: "CHUNK", value: "," });
      }
      work.push({ kind: "CHUNK", value: "[" });
      maxArrayTraversalDurationMs = Math.max(maxArrayTraversalDurationMs, performance.now() - arrayStarted);
      continue;
    }
    objectCount += 1;
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
      const endObjectKeys = startRuntimeWorkTrace("STABLE_JSON_OBJECT_KEYS", { category, keyCount: keys.length });
      endObjectKeys({ keysDurationMs, sortDurationMs });
    }
    const serializableKeys = keys.filter(key => {
      const nested = record[key];
      return nested !== undefined && typeof nested !== "function" && typeof nested !== "symbol";
    });
    work.push({ kind: "CHUNK", value: "}" });
    for (let index = serializableKeys.length - 1; index >= 0; index -= 1) {
      const key = serializableKeys[index];
      work.push({ kind: "VALUE", value: record[key], inArray: false, depth: item.depth + 1 });
      work.push({ kind: "CHUNK", value: ":" });
      work.push({ kind: "CHUNK", value: JSON.stringify(key) });
      if (index > 0) work.push({ kind: "CHUNK", value: "," });
    }
    work.push({ kind: "CHUNK", value: "{" });
  }
  const finalBatchDurationMs = performance.now() - sliceStarted;
  finishBatch(finalBatchDurationMs);
  flushChunks();
  options.onSlice?.(finalBatchDurationMs);
  await yieldControl();
  endBuild({
    category,
    invocation,
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
    tokenCount,
    totalChunkCharacters,
    maxChunkCharacters,
  });
  const endJoin = startRuntimeWorkTrace("STABLE_JSON_JOIN", { category, invocation, chunkCount: chunks.length, tokenCount, totalChunkCharacters, maxChunkCharacters });
  const result = chunks.join("");
  endJoin({ category, outputBytes: result.length });
  return result;
}
