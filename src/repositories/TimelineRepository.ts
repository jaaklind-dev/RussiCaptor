import { TimelineEvent } from "@/models/TimelineEvent";
 import { getCurrentExercise } from "@/repositories/ExerciseRepository";

 const events: TimelineEvent[] = [];

 function createTimelineId(): string {
   return `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
 }

 export function getTimelineEvents(patientId: string): TimelineEvent[] {
   return events
     .filter((event) => event.patientId === patientId)
     .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
 }

 export function addTimelineEvent(event: TimelineEvent): void {
   events.push(event);
 }

 export function clearTimelineEvents(): void {
   events.splice(0, events.length);
 }

 export function logQuestionRevealed(
   patientId: string,
   questionId: string
 ): void {
   addTimelineEvent({
     id: createTimelineId(),
     exerciseId: getCurrentExercise().id,
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
     id: createTimelineId(),
     exerciseId: getCurrentExercise().id,
     patientId,
     timestamp: new Date().toISOString(),
     type: "lab",
     title: `${panel} viewed`,
     description: `${panel} laboratory panel was opened.`,
     author: "CM",
     visibility: "revealed",
   });
 }
