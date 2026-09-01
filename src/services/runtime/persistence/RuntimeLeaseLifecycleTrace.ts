import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";

export type RuntimeLeaseTraceEvent = Readonly<{
  event: string;
  atMs: number;
  service: string;
  generation?: string;
  scheduler?: string;
  detail: Readonly<Record<string, string | number | boolean | undefined>>;
}>;

const MAX_EVENTS = 96;
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
  events.push(
    Object.freeze({
      event,
      atMs: Date.now(),
      service,
      generation: input.generation,
      scheduler: input.scheduler,
      detail: Object.freeze({ ...input.detail }),
    }),
  );
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getRuntimeLeaseLifecycleTrace(): readonly RuntimeLeaseTraceEvent[] {
  return Object.freeze(
    events.map((event) =>
      Object.freeze({ ...event, detail: Object.freeze({ ...event.detail }) }),
    ),
  );
}

/** Clears validation evidence only; it never touches Runtime state or timers. */
export function clearRuntimeLeaseTraceForValidation(): boolean {
  if (!isSharedWorkflowValidationHarnessEnabled()) return false;
  events.splice(0, events.length);
  traceRuntimeLeaseLifecycle("LEASE_TRACE_CLEARED", { detail: {} });
  return true;
}
