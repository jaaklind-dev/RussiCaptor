import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { nextRuntimeLeaseTraceLabel, traceRuntimeLeaseLifecycle } from "./RuntimeLeaseLifecycleTrace";

/** App-lifetime validation probe; deliberately independent of Runtime authority. */
export function startRuntimeLeaseTimerProbe(): () => void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return () => {};
  const probe = nextRuntimeLeaseTraceLabel("js-probe");
  traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_STARTED", { detail: { probe } });
  const timer = setInterval(() => traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_TICK", { detail: { probe } }), 10_000);
  const lagProbe = nextRuntimeLeaseTraceLabel("event-loop-probe");
  const lagIntervalMs = 1_000;
  let expectedAtMs = Date.now() + lagIntervalMs;
  const lagTimer = setInterval(() => {
    const actualAtMs = Date.now();
    const delayMs = Math.max(0, actualAtMs - expectedAtMs);
    // A resumed suspended loop contributes one bounded observation, not one
    // synthetic observation for every interval missed while it was paused.
    expectedAtMs = actualAtMs + lagIntervalMs;
    if (delayMs > 250) {
      traceRuntimeLeaseLifecycle("JS_EVENT_LOOP_LAG", {
        detail: {
          probe: lagProbe,
          delayMs,
          threshold: delayMs > 5_000 ? "GT_5S" : delayMs > 1_000 ? "GT_1S" : "GT_250MS",
        },
      });
    }
  }, lagIntervalMs);
  return () => {
    clearInterval(timer);
    clearInterval(lagTimer);
    traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_STOPPED", { detail: { probe, reason: "APP_SHUTDOWN" } });
  };
}
