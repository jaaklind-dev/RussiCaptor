import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";

export type RuntimeLeaseTraceEvent = Readonly<{
  event: string;
  atMs: number;
  service: string;
  generation?: string;
  scheduler?: string;
  detail: Readonly<Record<string, string | number | boolean | undefined>>;
}>;

const MAX_EVENTS = 192;
const service = "runtime-sync-1";
let sequence = 0;
const events: RuntimeLeaseTraceEvent[] = [];

export function nextRuntimeLeaseTraceLabel(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** Validation-only, bounded, and structurally unable to retain credentials or patient state. */
export function traceRuntimeLeaseLifecycle(
  event: string,
  input: Omit<RuntimeLeaseTraceEvent, "event" | "atMs" | "service">,
): void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return;
  const traceEvent = Object.freeze({
    event,
    atMs: Date.now(),
    service,
    generation: input.generation,
    scheduler: input.scheduler,
    detail: Object.freeze({ ...input.detail }),
  });
  events.push(traceEvent);
  // The validation harness uses only aggregate, payload-free detail. Native
  // device logs make a trace retrievable even when the UI event loop stalls.
  console.info("RUNTIME_LEASE_TRACE", JSON.stringify(traceEvent));
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getRuntimeLeaseLifecycleTrace(): readonly RuntimeLeaseTraceEvent[] {
  return Object.freeze(
    events.map((event) =>
      Object.freeze({ ...event, detail: Object.freeze({ ...event.detail }) }),
    ),
  );
}

/**
 * Records only bounded aggregate timing for validation builds.  It deliberately
 * accepts no payload object, identifiers, or user-facing content.
 */
export function startRuntimeWorkTrace(
  operation: string,
  detail: Readonly<Record<string, string | number | boolean | undefined>> = {},
): (result?: Readonly<Record<string, string | number | boolean | undefined>>) => void {
  const startedAt = Date.now();
  traceRuntimeLeaseLifecycle("RUNTIME_WORK_BEGIN", { detail: { operation, ...detail } });
  return (result = {}) => {
    traceRuntimeLeaseLifecycle("RUNTIME_WORK_END", {
      detail: { operation, durationMs: Date.now() - startedAt, ...detail, ...result },
    });
  };
}

/** Clears validation evidence only; it never touches Runtime state or timers. */
export function clearRuntimeLeaseTraceForValidation(): boolean {
  if (!isSharedWorkflowValidationHarnessEnabled()) return false;
  events.splice(0, events.length);
  traceRuntimeLeaseLifecycle("LEASE_TRACE_CLEARED", { detail: {} });
  return true;
}
