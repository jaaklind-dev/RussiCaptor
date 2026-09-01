import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { nextRuntimeLeaseTraceLabel, traceRuntimeLeaseLifecycle } from "./RuntimeLeaseLifecycleTrace";

/** App-lifetime validation probe; deliberately independent of Runtime authority. */
export function startRuntimeLeaseTimerProbe(): () => void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return () => {};
  const probe = nextRuntimeLeaseTraceLabel("js-probe");
  traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_STARTED", { detail: { probe } });
  const timer = setInterval(() => traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_TICK", { detail: { probe } }), 10_000);
  return () => { clearInterval(timer); traceRuntimeLeaseLifecycle("JS_TIMER_PROBE_STOPPED", { detail: { probe, reason: "APP_SHUTDOWN" } }); };
}
