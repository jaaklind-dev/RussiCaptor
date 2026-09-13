import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { IncrementalSha256, type Sha256AsyncOptions } from "@/utils/sha256";

const MAX_ARRAY_INDEX = 0xffff_fffe;

// String#localeCompare constructs/resolves locale collation for every call on
// Hermes. A single retained checkpoint can contain tens of thousands of
// repeated small object shapes, turning those few-key sorts into minutes of
// JS-thread work. ECMA-402 defines the no-argument forms through the same
// default Collator; retain one bound comparator instead of resolving it for
// every comparison.
const compareLocaleCanonicalKeys = new Intl.Collator().compare;

function arrayIndexOf(key: string): number | undefined {
  if (!key.length) return undefined;
  const value = Number(key);
  return Number.isInteger(value) && value >= 0 && value <= MAX_ARRAY_INDEX && String(value) === key
    ? value
    : undefined;
}

function compareCanonicalKeys(left: string, right: string): number {
  // JSON.stringify enumerates own array-index keys numerically before other
  // string keys, even when Object.fromEntries inserted them in collated order.
  // Model that established output directly so the async emitter remains byte
  // equivalent for numerically-looking keys as well.
  const leftIndex = arrayIndexOf(left);
  const rightIndex = arrayIndexOf(right);
  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  }
  return compareLocaleCanonicalKeys(left, right);
}

function keyShape(keys: readonly string[]): string {
  // Length-prefixing is collision-free even when a property name contains a
  // separator. The cache is scoped to one canonicalization call, so mutable
  // objects and later calls cannot observe stale structural metadata.
  return `${keys.length}|${keys.map(key => `${key.length}:${key}`).join("")}`;
}

function orderedKeys(
  record: Record<string, unknown>,
  cache: Map<string, readonly string[]>,
): readonly string[] {
  const keys = Object.keys(record);
  const shape = keyShape(keys);
  const cached = cache.get(shape);
  if (cached) return cached;
  keys.sort(compareCanonicalKeys);
  cache.set(shape, keys);
  return keys;
}

function canonicalize(value: unknown, keyOrderCache: Map<string, readonly string[]>): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalize(item, keyOrderCache));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(orderedKeys(record, keyOrderCache)
    .map(key => [key, canonicalize(record[key], keyOrderCache)]));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Map()));
}

export type StableJsonMetrics = Readonly<{
  nodesVisited: number;
  objectCount: number;
  objectKeysCalls: number;
  objectEntriesCalls: number;
  keyArrayAllocations: number;
  shapeSignatureBuilds: number;
  fastPathObjectCount: number;
  genericFallbackObjectCount: number;
  uniqueCanonicalKeyCount: number;
  propertyVisitCount: number;
  totalKeyExtractionDurationMs: number;
  totalShapeSignatureDurationMs: number;
  nativeDiscoveryDurationMs: number;
  nativeSerializationDurationMs: number;
  sortCount: number;
  comparatorInvocationCount: number;
  keyOrderCacheHits: number;
  keyOrderCacheMisses: number;
  totalKeySortDurationMs: number;
  maxKeySortDurationMs: number;
}>;

export type StableJsonAsyncOptions = Readonly<{
  /** Validation-only opaque category; never serialized into checkpoint data. */
  traceCategory?: "RUNTIME_PAYLOAD" | "FULL_CHECKPOINT" | "DELTA" | "OTHER";
  yieldEvery?: number;
  /** Maximum continuous JavaScript work before yielding, when configured. */
  maxSliceMs?: number;
  yieldControl?: () => Promise<void>;
  onSlice?: (durationMs: number) => void;
  onComplete?: (metrics: StableJsonMetrics) => void;
  /**
   * Checkpoint-only fast path for plain JSON-compatible data. Native
   * JSON.stringify discovers each holder's key sequence into a compact shape
   * trie. Repeated objects then share one canonical key array. Unknown keys
   * remain included without Object.keys or per-object signature allocation.
   */
  objectTraversal?: "ITERATIVE" | "NATIVE_JSON_SHAPE_TRIE";
  /** Bounded canonical output chunk target. Tokens are never split unsafely. */
  chunkCharacters?: number;
}>;

type StableJsonWorkItem =
  | Readonly<{ kind: "VALUE"; value: unknown; inArray: boolean; depth: number; prefix: string }>
  | Readonly<{ kind: "END"; value: "]" | "}" }>;

export type StableJsonHashMetrics = Readonly<{
  canonicalCharacters: number;
  utf8Bytes: number;
  tokenWriteCount: number;
  chunkCount: number;
  averageChunkCharacters: number;
  maxChunkCharacters: number;
  utf8DurationMs: number;
  shaDurationMs: number;
}>;

export type StableJsonHashOptions = StableJsonAsyncOptions & Readonly<{
  hashBlocksPerSlice?: number;
  onHashComplete?: (metrics: StableJsonHashMetrics) => void;
  /** Captures the exact canonical text from the same traversal that hashes it. */
  onCanonicalText?: (canonicalText: string) => void;
}>;

let stableJsonAsyncInvocation = 0;

type CanonicalShapeNode = {
  readonly parent?: CanonicalShapeNode;
  readonly key?: string;
  readonly children: Map<string, CanonicalShapeNode>;
  orderedKeys?: readonly string[];
};

type NativeShapeDiscovery = Readonly<{
  shapeByObject: WeakMap<object, CanonicalShapeNode>;
  propertyVisitCount: number;
  uniqueKeyCount: number;
  durationMs: number;
}>;

function discoverCanonicalShapes(value: unknown): NativeShapeDiscovery {
  const rootShape: CanonicalShapeNode = { children: new Map() };
  const shapeByObject = new WeakMap<object, CanonicalShapeNode>();
  const uniqueKeys = new Set<string>();
  let root = true;
  let propertyVisitCount = 0;
  const started = performance.now();

  // JSON.stringify performs object enumeration natively on Hermes. The
  // replacer sees keys in each holder's native enumeration order, allowing a
  // compact trie to intern repeated shapes without Object.keys, Object.entries,
  // per-object key arrays, or per-object signature strings. Objects with a
  // custom toJSON are intentionally not associated with the transformed value
  // and therefore take the generic fail-safe path during canonicalization.
  JSON.stringify(value, function discoverShape(key, nested) {
    if (!root && !Array.isArray(this)) {
      const holder = this as object;
      const current = shapeByObject.get(holder) ?? rootShape;
      let next = current.children.get(key);
      if (!next) {
        next = { parent: current, key, children: new Map() };
        current.children.set(key, next);
      }
      shapeByObject.set(holder, next);
      uniqueKeys.add(key);
      propertyVisitCount += 1;
    }
    root = false;
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested) &&
      typeof (nested as { toJSON?: unknown }).toJSON !== "function") {
      shapeByObject.set(nested, rootShape);
    }
    return nested;
  });
  return { shapeByObject, propertyVisitCount, uniqueKeyCount: uniqueKeys.size,
    durationMs: performance.now() - started };
}

function keysFromShape(shape: CanonicalShapeNode): string[] {
  const keys: string[] = [];
  for (let current: CanonicalShapeNode | undefined = shape; current?.key !== undefined; current = current.parent) {
    keys.push(current.key);
  }
  keys.reverse();
  return keys;
}

/**
 * Byte-equivalent yielding form of stableJson. It emits canonical JSON
 * directly instead of allocating a second canonical object tree. Work is
 * sliced by visited values; the final string remains identical to the legacy
 * canonicalize + JSON.stringify contract.
 */
async function buildStableJsonAsync(
  value: unknown,
  options: StableJsonHashOptions,
  hashOnly: boolean,
): Promise<string> {
  const category = options.traceCategory ?? "OTHER";
  stableJsonAsyncInvocation += 1;
  const invocation = stableJsonAsyncInvocation;
  const endBuild = startRuntimeWorkTrace("STABLE_JSON_BUILD", { category, invocation });
  let nativeDiscovery: NativeShapeDiscovery | undefined;
  if (options.objectTraversal === "NATIVE_JSON_SHAPE_TRIE") {
    const endDiscovery = startRuntimeWorkTrace("STABLE_JSON_SHAPE_DISCOVERY", { category, invocation });
    nativeDiscovery = discoverCanonicalShapes(value);
    endDiscovery({
      category,
      invocation,
      propertyVisitCount: nativeDiscovery.propertyVisitCount,
      uniqueCanonicalKeyCount: nativeDiscovery.uniqueKeyCount,
    });
  }
  const chunks: string[] = [];
  const hashQueue: string[] = [];
  const hash = hashOnly ? new IncrementalSha256() : undefined;
  const encoder = hashOnly ? new TextEncoder() : undefined;
  const chunkTarget = Math.max(1_024, options.chunkCharacters ?? 32_768);
  let bufferedTokens: string[] = [];
  let bufferedCharacters = 0;
  let totalChunkCharacters = 0;
  let maxChunkCharacters = 0;
  let tokenCount = 0;
  let outputChunkCount = 0;
  let utf8Bytes = 0;
  let utf8DurationMs = 0;
  let shaDurationMs = 0;
  const acceptOutputChunk = (chunk: string): void => {
    if (!chunk.length) return;
    outputChunkCount += 1;
    totalChunkCharacters += chunk.length;
    maxChunkCharacters = Math.max(maxChunkCharacters, chunk.length);
    if (hashOnly) {
      hashQueue.push(chunk);
      if (options.onCanonicalText) chunks.push(chunk);
    }
    else chunks.push(chunk);
  };
  const flushBufferedTokens = (): void => {
    if (!bufferedTokens.length) return;
    acceptOutputChunk(bufferedTokens.join(""));
    bufferedTokens = [];
    bufferedCharacters = 0;
  };
  const pushChunk = (chunk: string): void => {
    if (!chunk.length) return;
    tokenCount += 1;
    chunkPushesSinceYield += 1;
    if (chunk.length >= chunkTarget) {
      flushBufferedTokens();
      for (let start = 0; start < chunk.length;) {
        let end = Math.min(chunk.length, start + chunkTarget);
        if (end < chunk.length && chunk.charCodeAt(end - 1) >= 0xd800 && chunk.charCodeAt(end - 1) <= 0xdbff &&
          chunk.charCodeAt(end) >= 0xdc00 && chunk.charCodeAt(end) <= 0xdfff) end += 1;
        acceptOutputChunk(chunk.slice(start, end));
        start = end;
      }
      return;
    }
    if (bufferedCharacters + chunk.length > chunkTarget) flushBufferedTokens();
    bufferedTokens.push(chunk);
    bufferedCharacters += chunk.length;
  };
  const flushHashQueue = async (): Promise<void> => {
    flushBufferedTokens();
    if (!hash || !encoder) return;
    const shaOptions: Sha256AsyncOptions = {
      yieldControl: options.yieldControl,
      blocksPerSlice: options.hashBlocksPerSlice ?? 16,
      maxSliceMs: options.maxSliceMs,
      onSlice: options.onSlice,
      traceCategory: options.traceCategory,
    };
    while (hashQueue.length) {
      const chunk = hashQueue.shift()!;
      const encodeStarted = performance.now();
      const bytes = encoder.encode(chunk);
      utf8DurationMs += performance.now() - encodeStarted;
      utf8Bytes += bytes.length;
      const shaStarted = performance.now();
      await hash.updateAsync(bytes, shaOptions);
      shaDurationMs += performance.now() - shaStarted;
    }
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
  let totalKeyExtractionDurationMs = 0;
  let totalShapeSignatureDurationMs = 0;
  let objectKeysCalls = 0;
  let keyArrayAllocations = 0;
  let shapeSignatureBuilds = 0;
  let fastPathObjectCount = 0;
  let genericFallbackObjectCount = 0;
  let maxObjectKeys = 0;
  let maxObjectKeysDurationMs = 0;
  let maxKeySortDurationMs = 0;
  let totalKeySortDurationMs = 0;
  let sortCount = 0;
  let comparatorInvocationCount = 0;
  let keyOrderCacheHits = 0;
  let keyOrderCacheMisses = 0;
  const keyOrderCache = new Map<string, readonly string[]>();
  let maxArrayLength = 0;
  let maxArrayTraversalDurationMs = 0;
  let appendCalls = 0;
  let maxRecursionDepth = 0;
  let maxChunkPushBurst = 0;
  let chunkPushesSinceYield = 0;
  let batchId = 0;

  if (nativeDiscovery) {
    options.onSlice?.(nativeDiscovery.durationMs);
    await yieldControl();
    yieldCount += 1;
    sliceStarted = performance.now();
  }

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
  const work: StableJsonWorkItem[] = [{ kind: "VALUE", value, inArray: false, depth: 0, prefix: "" }];
  while (work.length) {
    const item = work.pop()!;
    if (item.kind === "END") {
      pushChunk(item.value);
      continue;
    }
    pushChunk(item.prefix);
    const current = item.value;
    appendCalls += 1;
    maxRecursionDepth = Math.max(maxRecursionDepth, item.depth);
    visited += 1;
    if (visited % yieldEvery === 0 &&
      (maxSliceMs === undefined || performance.now() - sliceStarted >= maxSliceMs)) {
      const durationMs = performance.now() - sliceStarted;
      finishBatch(durationMs);
      await flushHashQueue();
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
      work.push({ kind: "END", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        work.push({ kind: "VALUE", value: current[index], inArray: true, depth: item.depth + 1,
          prefix: index > 0 ? "," : "" });
      }
      pushChunk("[");
      maxArrayTraversalDurationMs = Math.max(maxArrayTraversalDurationMs, performance.now() - arrayStarted);
      continue;
    }
    objectCount += 1;
    const record = current as Record<string, unknown>;
    const discoveredShape = nativeDiscovery?.shapeByObject.get(record);
    let keys: readonly string[];
    let sortDurationMs = 0;
    let keysDurationMs = 0;
    if (discoveredShape) {
      fastPathObjectCount += 1;
      if (discoveredShape.orderedKeys) {
        keys = discoveredShape.orderedKeys;
        keyOrderCacheHits += 1;
      } else {
        keyOrderCacheMisses += 1;
        keys = keysFromShape(discoveredShape);
        keyArrayAllocations += 1;
        const sortStarted = performance.now();
        (keys as string[]).sort((left, right) => {
          comparatorInvocationCount += 1;
          return compareCanonicalKeys(left, right);
        });
        sortDurationMs = performance.now() - sortStarted;
        totalKeySortDurationMs += sortDurationMs;
        sortCount += 1;
        discoveredShape.orderedKeys = keys;
      }
    } else {
      genericFallbackObjectCount += 1;
      objectKeysCalls += 1;
      keyArrayAllocations += 1;
      const keysStarted = performance.now();
      let genericKeys = Object.keys(record);
      keysDurationMs = performance.now() - keysStarted;
      totalKeyExtractionDurationMs += keysDurationMs;
      maxObjectKeysDurationMs = Math.max(maxObjectKeysDurationMs, keysDurationMs);
      const shapeStarted = performance.now();
      const shape = keyShape(genericKeys);
      shapeSignatureBuilds += 1;
      totalShapeSignatureDurationMs += performance.now() - shapeStarted;
      const cachedKeys = keyOrderCache.get(shape);
      if (cachedKeys) {
        genericKeys = cachedKeys.slice();
        keyArrayAllocations += 1;
        keyOrderCacheHits += 1;
      } else {
        keyOrderCacheMisses += 1;
        const sortStarted = performance.now();
        genericKeys.sort((left, right) => {
          comparatorInvocationCount += 1;
          return compareCanonicalKeys(left, right);
        });
        sortDurationMs = performance.now() - sortStarted;
        totalKeySortDurationMs += sortDurationMs;
        sortCount += 1;
        keyOrderCache.set(shape, genericKeys.slice());
        keyArrayAllocations += 1;
      }
      keys = genericKeys;
    }
    maxObjectKeys = Math.max(maxObjectKeys, keys.length);
    totalKeys += keys.length;
    maxKeySortDurationMs = Math.max(maxKeySortDurationMs, sortDurationMs);
    if (keys.length >= 1_000 || sortDurationMs >= 50 || keysDurationMs >= 50) {
      const endObjectKeys = startRuntimeWorkTrace("STABLE_JSON_OBJECT_KEYS", { category, keyCount: keys.length });
      endObjectKeys({ keysDurationMs, sortDurationMs });
    }
    let serializableKeyCount = 0;
    for (const key of keys) {
      const nested = record[key];
      if (nested !== undefined && typeof nested !== "function" && typeof nested !== "symbol") {
        serializableKeyCount += 1;
      }
    }
    work.push({ kind: "END", value: "}" });
    let serializableKeyIndex = serializableKeyCount - 1;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const nested = record[key];
      if (nested === undefined || typeof nested === "function" || typeof nested === "symbol") continue;
      work.push({ kind: "VALUE", value: record[key], inArray: false, depth: item.depth + 1,
        prefix: `${serializableKeyIndex > 0 ? "," : ""}${JSON.stringify(key)}:` });
      serializableKeyIndex -= 1;
    }
    pushChunk("{");
  }
  const finalBatchDurationMs = performance.now() - sliceStarted;
  finishBatch(finalBatchDurationMs);
  await flushHashQueue();
  options.onSlice?.(finalBatchDurationMs);
  await yieldControl();
  const metrics: StableJsonMetrics = {
    nodesVisited: visited,
    objectCount,
    objectKeysCalls,
    objectEntriesCalls: 0,
    keyArrayAllocations,
    shapeSignatureBuilds,
    fastPathObjectCount,
    genericFallbackObjectCount,
    uniqueCanonicalKeyCount: nativeDiscovery?.uniqueKeyCount ?? 0,
    propertyVisitCount: nativeDiscovery?.propertyVisitCount ?? totalKeys,
    totalKeyExtractionDurationMs,
    totalShapeSignatureDurationMs,
    nativeDiscoveryDurationMs: nativeDiscovery?.durationMs ?? 0,
    nativeSerializationDurationMs: 0,
    sortCount,
    comparatorInvocationCount,
    keyOrderCacheHits,
    keyOrderCacheMisses,
    totalKeySortDurationMs,
    maxKeySortDurationMs,
  };
  options.onComplete?.(metrics);
  endBuild({
    category,
    invocation,
    traversal: nativeDiscovery ? "NATIVE_JSON_SHAPE_TRIE" : "ITERATIVE",
    nodesVisited: visited,
    appendCalls,
    objectCount,
    arrayCount,
    scalarCount,
    stringCount,
    totalKeys,
    totalKeyExtractionDurationMs,
    totalShapeSignatureDurationMs,
    maxObjectKeys,
    maxObjectKeysDurationMs,
    maxKeySortDurationMs,
    totalKeySortDurationMs,
    sortCount,
    comparatorInvocationCount,
    keyOrderCacheHits,
    keyOrderCacheMisses,
    maxArrayLength,
    maxArrayTraversalDurationMs,
    maxRecursionDepth,
    yieldCount,
    maxBatchDurationMs,
    maxNodesBetweenYields,
    maxChunkPushBurst,
    chunkCount: outputChunkCount,
    tokenCount,
    totalChunkCharacters,
    maxChunkCharacters,
    utf8Bytes,
    utf8DurationMs,
    shaDurationMs,
    hashOnly,
  });
  if (hash && hashOnly) {
    const digestStarted = performance.now();
    const digest = hash.digest();
    shaDurationMs += performance.now() - digestStarted;
    const hashMetrics: StableJsonHashMetrics = {
      canonicalCharacters: totalChunkCharacters,
      utf8Bytes,
      tokenWriteCount: tokenCount,
      chunkCount: outputChunkCount,
      averageChunkCharacters: outputChunkCount ? totalChunkCharacters / outputChunkCount : 0,
      maxChunkCharacters,
      utf8DurationMs,
      shaDurationMs,
    };
    options.onHashComplete?.(hashMetrics);
    if (options.onCanonicalText) options.onCanonicalText(chunks.join(""));
    const endHash = startRuntimeWorkTrace("STABLE_JSON_STREAM_HASH", {
      category, invocation, chunkCount: outputChunkCount, canonicalCharacters: totalChunkCharacters, utf8Bytes,
    });
    endHash({ utf8DurationMs, shaDurationMs });
    return digest;
  }
  const endJoin = startRuntimeWorkTrace("STABLE_JSON_JOIN", { category, invocation, chunkCount: outputChunkCount, tokenCount, totalChunkCharacters, maxChunkCharacters });
  const result = chunks.join("");
  endJoin({ category, outputBytes: result.length });
  return result;
}

export function stableJsonAsync(
  value: unknown,
  options: StableJsonAsyncOptions = {},
): Promise<string> {
  return buildStableJsonAsync(value, options, false);
}

/**
 * SHA-256 of UTF8(stableJson(value)) without retaining either the full
 * canonical string or a whole-payload UTF-8 array. Canonical chunks are
 * complete JSON token segments, so native UTF-8 encoding cannot split a
 * surrogate pair at a flush boundary.
 */
export function stableJsonHashAsync(
  value: unknown,
  options: StableJsonHashOptions = {},
): Promise<string> {
  return buildStableJsonAsync(value, options, true);
}
