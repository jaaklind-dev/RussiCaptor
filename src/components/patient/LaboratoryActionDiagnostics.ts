import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";

export type LaboratoryActionTraceEvent = Readonly<{
  event: "LAB_ACTION_MOUNT" | "LAB_ACTION_UNMOUNT" | "LAB_ACTION_RENDER" |
    "LAB_ACTION_PRESS_IN" | "LAB_ACTION_PRESS_OUT" | "LAB_ACTION_PRESS" |
    "LAB_ACTION_RESPONDER_GRANT" | "LAB_ACTION_RESPONDER_TERMINATE";
  atMs: number;
  detail: Readonly<{
    controlInstanceId: string;
    semanticActionId: string;
    intent: "LAB_ORDER" | "LAB_COLLECT";
    projectionRevision: number;
    disabled: boolean;
  }>;
}>;

const MAX_EVENTS = 128;
const events: LaboratoryActionTraceEvent[] = [];

/** Validation-only, bounded UI trace. It contains no credentials or clinical payload. */
export function traceLaboratoryAction(
  event: LaboratoryActionTraceEvent["event"],
  detail: LaboratoryActionTraceEvent["detail"],
): void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return;
  const traceEvent = Object.freeze({ event, atMs: Date.now(), detail: Object.freeze({ ...detail }) });
  events.push(traceEvent);
  console.info("LAB_ACTION_TRACE", JSON.stringify(traceEvent));
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getLaboratoryActionTrace(): readonly LaboratoryActionTraceEvent[] {
  return Object.freeze(events.map(event => Object.freeze({
    ...event,
    detail: Object.freeze({ ...event.detail }),
  })));
}

export function clearLaboratoryActionTraceForValidation(): void {
  events.splice(0, events.length);
}
