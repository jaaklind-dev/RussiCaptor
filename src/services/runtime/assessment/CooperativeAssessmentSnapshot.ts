import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";

export type CooperativeWorkMetrics = {
  yieldCount: number;
  maxBatchDurationMs: number;
};

const DEFAULT_BATCH_MS = 16;
const DEFAULT_BATCH_ITEMS = 256;

function combineMetrics(...values: CooperativeWorkMetrics[]): CooperativeWorkMetrics {
  return {
    yieldCount: values.reduce((sum, item) => sum + item.yieldCount, 0),
    maxBatchDurationMs: Math.max(0, ...values.map(item => item.maxBatchDurationMs)),
  };
}

/**
 * Detached, order-preserving array copy for the production rehydrate path.
 * It intentionally retains the per-item structured-clone boundary used by
 * assessment snapshots while giving React Native a frame between batches.
 */
export async function cooperativeDetachedCopy<T>(
  source: readonly T[],
  yieldControl: PipelineYield,
  batchSize = DEFAULT_BATCH_ITEMS,
  maxBatchMs = DEFAULT_BATCH_MS,
): Promise<{ value: T[]; metrics: CooperativeWorkMetrics }> {
  const value: T[] = [];
  let yieldCount = 0;
  let maxBatchDurationMs = 0;
  for (let start = 0; start < source.length;) {
    const batchStartedAt = performance.now();
    const batchLimit = Math.min(source.length, start + batchSize);
    let end = start;
    while (end < batchLimit) {
      value.push(structuredClone(source[end]));
      end += 1;
      if (performance.now() - batchStartedAt >= maxBatchMs) break;
    }
    maxBatchDurationMs = Math.max(maxBatchDurationMs, performance.now() - batchStartedAt);
    if (end < source.length) { await yieldControl(); yieldCount += 1; }
    start = end;
  }
  return { value, metrics: { yieldCount, maxBatchDurationMs } };
}

/** Stable bottom-up merge sort. Equal values always retain their input order. */
export async function cooperativeStableSort<T>(
  source: readonly T[],
  comparator: (left: T, right: T) => number,
  yieldControl: PipelineYield,
  maxBatchMs = DEFAULT_BATCH_MS,
): Promise<{ value: T[]; metrics: CooperativeWorkMetrics }> {
  let input = [...source];
  let output = new Array<T>(input.length);
  let yieldCount = 0;
  let maxBatchDurationMs = 0;
  for (let width = 1; width < input.length; width *= 2) {
    let batchStartedAt = performance.now();
    for (let start = 0; start < input.length; start += width * 2) {
      const middle = Math.min(start + width, input.length);
      const end = Math.min(start + width * 2, input.length);
      let left = start; let right = middle; let target = start;
      while (left < middle || right < end) {
        output[target++] = right >= end || (left < middle && comparator(input[left], input[right]) <= 0)
          ? input[left++] : input[right++];
        if (performance.now() - batchStartedAt >= maxBatchMs) {
          maxBatchDurationMs = Math.max(maxBatchDurationMs, performance.now() - batchStartedAt);
          await yieldControl(); yieldCount += 1; batchStartedAt = performance.now();
        }
      }
    }
    maxBatchDurationMs = Math.max(maxBatchDurationMs, performance.now() - batchStartedAt);
    [input, output] = [output, input];
    if (width * 2 < input.length) { await yieldControl(); yieldCount += 1; }
  }
  return { value: input, metrics: { yieldCount, maxBatchDurationMs } };
}

export async function cooperativeSortedDetachedCopy<T>(
  source: readonly T[],
  comparator: (left: T, right: T) => number,
  yieldControl: PipelineYield,
): Promise<{ value: T[]; metrics: CooperativeWorkMetrics }> {
  const sorted = await cooperativeStableSort(source, comparator, yieldControl);
  const copied = await cooperativeDetachedCopy(sorted.value, yieldControl);
  return { value: copied.value, metrics: combineMetrics(sorted.metrics, copied.metrics) };
}
