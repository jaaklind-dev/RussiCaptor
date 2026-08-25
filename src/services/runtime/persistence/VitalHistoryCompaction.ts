import type { VitalSignEvent } from "@/models/VitalSign";

/**
 * No canonical consumer needs the full derived vital-change series. The exact
 * tail is retained as a diagnostic compatibility window; current physiology is
 * owned by RuntimeState.vitalSignState and clinical evidence by eventLog/Timeline.
 */
export const ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT = 256;

export function boundedVitalSignEvents(events: readonly VitalSignEvent[]): VitalSignEvent[] {
  return structuredClone(events.slice(-ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT));
}
