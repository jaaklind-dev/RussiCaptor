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

export function logQuestionRevealed(
  patientId: string,
  questionId: string
): void {
  addTimelineEvent({
    id: `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

    exerciseId: "demo",

    patientId,

    timestamp: new Date().toISOString(),

    type: "question",

    title: "Question revealed",

    description: `Question ${questionId} was revealed.`,

    author: "CM",

    visibility: "revealed",
  });
}
export function logLabPanelViewed(
  patientId: string,
  panel: string
): void {
  addTimelineEvent({
    id: `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

    exerciseId: "demo",

    patientId,

    timestamp: new Date().toISOString(),

    type: "lab",

    title: `${panel} viewed`,

    description: `${panel} laboratory panel was opened.`,

    author: "CM",

    visibility: "revealed",
  });
}