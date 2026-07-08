import { TimelineEvent } from "@/models/TimelineEvent";

const events: TimelineEvent[] = [];

export function getTimelineEvents(patientId: string): TimelineEvent[] {
  return events
    .filter((event) => event.patientId === patientId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function addTimelineEvent(event: TimelineEvent): void {
  events.push(event);
}