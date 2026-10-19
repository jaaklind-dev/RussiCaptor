/** Test-only observation utilities. Never imported by application code. */
import { arch, hrtime, memoryUsage, platform, versions } from "node:process";

const origin = hrtime.bigint();
export const monotonicNow = (): number => Number(hrtime.bigint() - origin) / 1_000_000;

/** Make the unchanged runtime helpers use the same real clock as the observer. */
export async function withMonotonicClock<T>(run: () => Promise<T>): Promise<T> {
  const object = globalThis.performance;
  const previous = Object.getOwnPropertyDescriptor(object, "now");
  Object.defineProperty(object, "now", { configurable: true, writable: true, value: monotonicNow });
  try {
    if (performance.now !== monotonicNow) throw new Error("BENCHMARK_CLOCK_NOT_INSTALLED");
    return await run();
  } finally {
    if (previous) Object.defineProperty(object, "now", previous);
    else Reflect.deleteProperty(object, "now");
  }
}

export function assertOriginalSliceLimit(slices: readonly number[]): void {
  expect(slices.length).toBeGreaterThan(0);
  expect(slices.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
  // This is the ORIGINAL union of serializer + inner/outer SHA onSlice reports.
  // Do not substitute total phase time, a median, or timer lag for this maximum.
  expect(Math.max(...slices)).toBeLessThan(250);
}

export async function phase<T>(name: string, run: () => T | Promise<T>,
  record: Record<string, unknown>): Promise<T> {
  const started = monotonicNow();
  try { return await run(); }
  finally {
    record[name] = monotonicNow() - started;
    console.info("WP_NARVA_10B10_PHASE", JSON.stringify({ name, elapsedMs: record[name],
      operation: record.operation, pass: record.pass, targetMb: record.targetMb }));
  }
}

export function logSample(record: Record<string, unknown>): void {
  console.info("WP_NARVA_10B10_SAMPLE", JSON.stringify({ ...record,
    clock: "process.hrtime.bigint", runtimeClockInstalled: performance.now === monotonicNow,
    node: versions.node, v8: versions.v8, platform, arch, memory: memoryUsage() }));
}

/** A fast but incomplete restore must fail independently of every timing gate. */
export function assertCompleteRestore<T>(expected: T, actual: T): void {
  expect(actual).toEqual(expected);
}
