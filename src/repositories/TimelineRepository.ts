import { TimelineEvent } from "@/models/TimelineEvent";
 import { getCurrentExercise } from "@/repositories/ExerciseRepository";
 import { clinicalDataProvider } from "@/providers/ProviderFactory";

 function getEvents(): TimelineEvent[] {
   return clinicalDataProvider.getTimelineEvents();
 }

 function createTimelineId(): string {
   return `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
 }

 export function getTimelineEvents(patientId: string): TimelineEvent[] {
   return getEvents()
     .filter((event) => event.patientId === patientId)
     .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
 }

 export function addTimelineEvent(event: TimelineEvent): void {
   getEvents().push(event);
 }

 export function clearTimelineEvents(): void {
   clinicalDataProvider.resetTimelineEvents();
 }

 export function getAllTimelineEvents(): TimelineEvent[] {
   return getEvents().map((event) => ({ ...event }));
 }

 export function restoreTimelineEvents(restored: TimelineEvent[]): void {
   const events = getEvents();
   events.splice(0, events.length, ...restored.map((event) => ({ ...event })));
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
