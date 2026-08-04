import { TimelineEvent } from "@/models/TimelineEvent";
 import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
 import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

 let nextSequenceNumber = 1;

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
   getEvents().push({ ...event, simulationTimeSec: event.simulationTimeSec ?? getCanonicalExerciseSnapshot().simulationTimeSec,
     sequenceNumber: event.sequenceNumber ?? nextSequenceNumber++ });
 }

export function clearTimelineEvents(): void {
   clinicalDataProvider.resetTimelineEvents();
   nextSequenceNumber = 1;
 }

 export function getAllTimelineEvents(): TimelineEvent[] {
   return getEvents().map((event) => ({ ...event }));
 }

export function restoreTimelineEvents(restored: TimelineEvent[]): void {
   const events = getEvents();
   events.splice(0, events.length, ...restored.map((event) => ({ ...event })));
   nextSequenceNumber = restored.reduce((maximum, event) => Math.max(maximum, event.sequenceNumber ?? 0), 0) + 1;
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
