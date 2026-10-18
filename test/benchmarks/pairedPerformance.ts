/** Node/Jest-only benchmark support. Never imported by application code. */
export const PAIRED_PERFORMANCE_PLAN = Object.freeze({ warmupPairs: 2, batches: 8, pairsPerBatch: 4 });

// React Native's Jest preset replaces global performance.now with Date.now.
// Use Node's independent monotonic nanosecond clock, not that wall-clock mock.
export function monotonicNowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export type PerformancePair = Readonly<{
  batch: number;
  pair: number;
  order: "REFERENCE_FIRST" | "OPTIMIZED_FIRST";
  referenceMs: number;
  optimizedMs: number;
  optimizedTimerDelayMs: number;
}>;

export function median(values: readonly number[]): number {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error("BENCHMARK_INVALID_SAMPLES");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distribution(values: readonly number[]) {
  const center = median(values);
  return { minimum: Math.min(...values), median: center, maximum: Math.max(...values),
    medianAbsoluteDeviation: median(values.map(value => Math.abs(value - center))) };
}

function oneSidedSignProbability(faster: number, total: number): number {
  let combinations = 1; let upperTail = 0;
  for (let successes = 0; successes <= total; successes += 1) {
    if (successes >= faster) upperTail += combinations;
    combinations = combinations * (total - successes) / (successes + 1);
  }
  return upperTail / 2 ** total;
}

export function summarizePairedPerformance(samples: readonly PerformancePair[]) {
  const { batches, pairsPerBatch } = PAIRED_PERFORMANCE_PLAN;
  if (samples.length !== batches * pairsPerBatch || samples.some(sample =>
    !Number.isFinite(sample.referenceMs) || sample.referenceMs <= 0 ||
    !Number.isFinite(sample.optimizedMs) || sample.optimizedMs <= 0 ||
    !Number.isFinite(sample.optimizedTimerDelayMs) || sample.optimizedTimerDelayMs < 0)) {
    throw new Error("BENCHMARK_INVALID_SAMPLES");
  }
  const batchMedianRatios = Array.from({ length: batches }, (_, batch) => {
    const group = samples.filter(sample => sample.batch === batch);
    if (group.length !== pairsPerBatch || new Set(group.map(sample => sample.pair)).size !== pairsPerBatch ||
      group.filter(sample => sample.order === "REFERENCE_FIRST").length !== pairsPerBatch / 2 ||
      group.filter(sample => sample.order === "OPTIMIZED_FIRST").length !== pairsPerBatch / 2) {
      throw new Error("BENCHMARK_UNBALANCED_SAMPLES");
    }
    return median(group.map(sample => sample.optimizedMs / sample.referenceMs));
  });
  const ratios = samples.map(sample => sample.optimizedMs / sample.referenceMs);
  const orderMedianRatios = Object.fromEntries((["REFERENCE_FIRST", "OPTIMIZED_FIRST"] as const).map(order => [
    order, median(samples.filter(sample => sample.order === order).map(sample => sample.optimizedMs / sample.referenceMs)),
  ]));
  // Aggregate within balanced blocks before the sign check, rather than treating
  // all within-process pairs as independent replications. This is a regression
  // decision rule, not a claim of independent hardware/process confidence.
  const fasterBatches = batchMedianRatios.filter(ratio => ratio < 1).length;
  const signProbability = oneSidedSignProbability(fasterBatches, batches);
  return {
    reference: distribution(samples.map(sample => sample.referenceMs)),
    optimized: distribution(samples.map(sample => sample.optimizedMs)),
    pairedRatios: distribution(ratios), batchMedianRatios, orderMedianRatios,
    fasterBatches, signProbability,
    maximumTimerDelayMs: Math.max(...samples.map(sample => sample.optimizedTimerDelayMs)),
    advantage: median(ratios) < 1 && Object.values(orderMedianRatios).every(ratio => ratio < 1) && signProbability < 0.05,
  };
}

export function requirePerformanceAdvantage(summary: ReturnType<typeof summarizePairedPerformance>): void {
  if (!summary.advantage) throw new Error("OPTIMIZED_CHECKPOINT_NOT_DEMONSTRABLY_FASTER");
}

export async function measurePairedPerformance<T>(
  reference: () => T,
  optimized: () => T,
  verifyEquivalent: (reference: T, optimized: T) => void,
) {
  const warmup: PerformancePair[] = []; const samples: PerformancePair[] = [];
  let lastReference!: T; let lastOptimized!: T;
  async function pair(batch: number, index: number): Promise<PerformancePair> {
    const order = index % 2 ? "OPTIMIZED_FIRST" : "REFERENCE_FIRST";
    let referenceMs = 0; let optimizedMs = 0; let optimizedTimerDelayMs = 0;
    for (const kind of order === "REFERENCE_FIRST" ? ["reference", "optimized"] : ["optimized", "reference"]) {
      if (kind === "reference") {
        const start = monotonicNowMs(); lastReference = reference(); referenceMs = monotonicNowMs() - start;
      } else {
        const timerStart = monotonicNowMs();
        // Preserve the existing renewal-like zero-delay timer check; this is not
        // a sleep used to manufacture favorable benchmark timings.
        const timer = new Promise<void>(resolve => setTimeout(() => {
          optimizedTimerDelayMs = monotonicNowMs() - timerStart; resolve();
        }, 0));
        const start = monotonicNowMs(); lastOptimized = optimized(); optimizedMs = monotonicNowMs() - start;
        await timer;
      }
    }
    // Semantic checks are outside both timed regions, on every warm-up/sample.
    verifyEquivalent(lastReference, lastOptimized);
    return { batch, pair: index, order, referenceMs, optimizedMs, optimizedTimerDelayMs };
  }
  for (let index = 0; index < PAIRED_PERFORMANCE_PLAN.warmupPairs; index += 1) warmup.push(await pair(-1, index));
  for (let batch = 0; batch < PAIRED_PERFORMANCE_PLAN.batches; batch += 1) {
    for (let index = 0; index < PAIRED_PERFORMANCE_PLAN.pairsPerBatch; index += 1) samples.push(await pair(batch, index));
  }
  return { warmup, samples, summary: summarizePairedPerformance(samples), lastReference, lastOptimized };
}
