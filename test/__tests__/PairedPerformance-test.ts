import { createHash } from "node:crypto";
import { median, measurePairedPerformance, monotonicNowMs, PAIRED_PERFORMANCE_PLAN,
  requirePerformanceAdvantage, summarizePairedPerformance, type PerformancePair } from "../benchmarks/pairedPerformance";

function samples(ratios: readonly number[]): PerformancePair[] {
  return ratios.flatMap((ratio, batch) => Array.from({ length: 4 }, (_, pair) => ({
    batch, pair, order: pair % 2 ? "OPTIMIZED_FIRST" as const : "REFERENCE_FIRST" as const,
    referenceMs: 10, optimizedMs: 10 * ratio, optimizedTimerDelayMs: 1,
  })));
}

describe("paired persistence benchmark contract", () => {
  test("timing is independent of mocked wall clock and global performance", () => {
    const wall = jest.spyOn(Date, "now").mockReturnValue(-123);
    const globalClock = jest.spyOn(performance, "now").mockReturnValue(-456);
    try {
      const start = monotonicNowMs(); const next = monotonicNowMs();
      expect(Number.isFinite(start)).toBe(true); expect(next).toBeGreaterThan(start);
      expect(start).not.toBe(-123); expect(start).not.toBe(-456);
      expect(wall).not.toHaveBeenCalled(); expect(globalClock).not.toHaveBeenCalled();
    } finally { wall.mockRestore(); globalClock.mockRestore(); }
  });

  test("genuine advantage passes, with no fixed expected duration", () => {
    const report = summarizePairedPerformance(samples(Array(8).fill(0.7)));
    expect(report.signProbability).toBe(1 / 256);
    expect(() => requirePerformanceAdvantage(report)).not.toThrow();
  });

  test("one adverse batch is recorded, not removed, and cannot replace aggregate checks", () => {
    const report = summarizePairedPerformance(samples([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.5]));
    expect(report.batchMedianRatios).toHaveLength(8);
    expect(report.pairedRatios.maximum).toBe(1.5);
    expect(report.signProbability).toBe(9 / 256);
    expect(report.advantage).toBe(true);
  });

  test.each([Array(8).fill(1), Array(8).fill(1.2), [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.2, 1.2]])(
    "equal, slower or insufficiently consistent batches fail (%j)", (...ratios: number[]) => {
      expect(() => requirePerformanceAdvantage(summarizePairedPerformance(samples(ratios))))
        .toThrow("OPTIMIZED_CHECKPOINT_NOT_DEMONSTRABLY_FASTER");
    },
  );

  test("order-sensitive advantage cannot pass", () => {
    const values = samples(Array(8).fill(0.5)).map(sample => sample.order === "OPTIMIZED_FIRST"
      ? { ...sample, optimizedMs: 11 } : sample);
    expect(summarizePairedPerformance(values).advantage).toBe(false);
  });

  test("missing, non-finite, non-positive and unbalanced samples fail closed", () => {
    const valid = samples(Array(8).fill(0.7));
    expect(() => summarizePairedPerformance(valid.slice(1))).toThrow("BENCHMARK_INVALID_SAMPLES");
    for (const invalid of [NaN, Infinity, 0, -1]) {
      expect(() => summarizePairedPerformance(valid.map((sample, index) => index ? sample : { ...sample, optimizedMs: invalid })))
        .toThrow("BENCHMARK_INVALID_SAMPLES");
    }
    expect(() => summarizePairedPerformance(valid.map(sample => ({ ...sample, order: "REFERENCE_FIRST" }))))
      .toThrow("BENCHMARK_UNBALANCED_SAMPLES");
    expect(() => median([])).toThrow("BENCHMARK_INVALID_SAMPLES");
  });

  test("real measured deliberately slower equivalent-work fixture is rejected", async () => {
    const payload = "synthetic-benchmark-fixture".repeat(4_096);
    const digest = () => createHash("sha256").update(payload).digest("hex");
    const report = await measurePairedPerformance(digest, () => {
      let result = "";
      for (let repeat = 0; repeat < 16; repeat += 1) result = digest();
      return result;
    }, (reference, optimized) => expect(optimized).toBe(reference));
    console.info("WP44B_SLOWER_FIXTURE_BENCHMARK", JSON.stringify({ plan: PAIRED_PERFORMANCE_PLAN,
      warmup: report.warmup, samples: report.samples, summary: report.summary }));
    expect(report.warmup).toHaveLength(2); expect(report.samples).toHaveLength(32);
    expect(() => requirePerformanceAdvantage(report.summary)).toThrow("OPTIMIZED_CHECKPOINT_NOT_DEMONSTRABLY_FASTER");
  });
});
