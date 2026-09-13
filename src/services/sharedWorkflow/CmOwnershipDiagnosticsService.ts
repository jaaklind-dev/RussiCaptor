import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";

export type CmOwnershipTraceEvent = Readonly<{
  event: "CM_OWNERSHIP_FETCHED" | "CM_OWNERSHIP_CLASSIFIED" | "CM_OWNERSHIP_PROJECTION_READY";
  atMs: number;
  detail: Readonly<{
    patientId?: string;
    ownerPrincipalId?: string;
    revision?: number;
    classification?: "SELF" | "OTHER_CM" | "UNOWNED" | "UNRESOLVED";
    ownedPatientCount?: number;
  }>;
}>;

const MAX_EVENTS = 96;
const events: CmOwnershipTraceEvent[] = [];

/** Validation-only trace containing ownership identifiers, never credentials or clinical payloads. */
export function traceCmOwnership(
  event: CmOwnershipTraceEvent["event"],
  detail: CmOwnershipTraceEvent["detail"],
): void {
  if (!isSharedWorkflowValidationHarnessEnabled()) return;
  const traceEvent = Object.freeze({ event, atMs: Date.now(), detail: Object.freeze({ ...detail }) });
  events.push(traceEvent);
  console.info("CM_OWNERSHIP_TRACE", JSON.stringify(traceEvent));
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getCmOwnershipTrace(): readonly CmOwnershipTraceEvent[] {
  return Object.freeze(events.map(event => Object.freeze({
    ...event,
    detail: Object.freeze({ ...event.detail }),
  })));
}

export function clearCmOwnershipTraceForValidation(): void {
  events.splice(0, events.length);
}
