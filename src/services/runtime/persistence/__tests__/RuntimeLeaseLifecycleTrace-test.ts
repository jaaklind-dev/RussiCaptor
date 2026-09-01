import {
  clearRuntimeLeaseTraceForValidation,
  getRuntimeLeaseLifecycleTrace,
  nextRuntimeLeaseTraceLabel,
  traceRuntimeLeaseLifecycle,
} from "../RuntimeLeaseLifecycleTrace";
import { startRuntimeLeaseTimerProbe } from "../RuntimeLeaseTimerProbe";

describe("Runtime lease validation trace", () => {
  const environment = {
    releaseEnvironment: process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT,
    enabled: process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS,
  };

  beforeEach(() => {
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = "1";
    clearRuntimeLeaseTraceForValidation();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = environment.releaseEnvironment;
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = environment.enabled;
  });

  test("keeps chronological bounded, payload-free validation evidence", () => {
    traceRuntimeLeaseLifecycle("FIRST", { generation: "generation-1", detail: { reason: "VALID_WRITER" } });
    traceRuntimeLeaseLifecycle("SECOND", { scheduler: "scheduler-1", detail: { latencyMs: 4 } });

    const trace = getRuntimeLeaseLifecycleTrace();
    expect(trace.map(item => item.event)).toEqual(["LEASE_TRACE_CLEARED", "FIRST", "SECOND"]);
    expect(JSON.stringify(trace)).not.toMatch(/token|password|patient|payload/i);

    for (let index = 0; index < 100; index += 1) {
      traceRuntimeLeaseLifecycle("BOUNDED", { detail: { index } });
    }
    expect(getRuntimeLeaseLifecycleTrace()).toHaveLength(96);
  });

  test("reset changes trace evidence only", () => {
    traceRuntimeLeaseLifecycle("BEFORE_RESET", { detail: {} });
    expect(clearRuntimeLeaseTraceForValidation()).toBe(true);
    expect(getRuntimeLeaseLifecycleTrace().map(item => item.event)).toEqual(["LEASE_TRACE_CLEARED"]);
  });

  test("app-lifetime JS probe is independent of a Runtime generation", () => {
    jest.useFakeTimers();
    const stop = startRuntimeLeaseTimerProbe();
    jest.advanceTimersByTime(10_000);
    stop();
    expect(getRuntimeLeaseLifecycleTrace().map(item => item.event)).toEqual(expect.arrayContaining([
      "JS_TIMER_PROBE_STARTED",
      "JS_TIMER_PROBE_TICK",
      "JS_TIMER_PROBE_STOPPED",
    ]));
    expect(nextRuntimeLeaseTraceLabel("probe")).toMatch(/^probe-\d+$/);
    jest.useRealTimers();
  });

  test("canonical production disables probe and detailed trace", () => {
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = undefined;
    const priorTrace = getRuntimeLeaseLifecycleTrace();
    expect(clearRuntimeLeaseTraceForValidation()).toBe(false);
    const stop = startRuntimeLeaseTimerProbe();
    traceRuntimeLeaseLifecycle("PRODUCTION_MUST_NOT_RECORD", { detail: {} });
    stop();
    expect(getRuntimeLeaseLifecycleTrace()).toEqual(priorTrace);
  });
});
