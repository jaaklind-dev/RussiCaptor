import { scenarioEvents } from "@/data/scenarioEvents";

import { ScenarioEvent } from "@/models/ScenarioEvent";

export function getPendingScenarioEvents(

  patientId: string

): ScenarioEvent[] {

  return scenarioEvents.filter(

    (event) =>

      event.patientId === patientId &&
      event.executed === false &&
      event.cancelled !== true

  );

}

export function markScenarioEventExecuted(

  eventId: string

): void {

  const event = scenarioEvents.find(

    (event) => event.id === eventId

  );

  if (event) {

    event.executed = true;

  }

}

export function addScenarioEvent(event: ScenarioEvent): void {
  scenarioEvents.push(event);
}

export function clearScenarioEvents(): void {
  scenarioEvents.splice(0, scenarioEvents.length);
}
export function cancelPendingScenarioEvents(patientId: string): void {
  scenarioEvents.forEach((event) => {
    if (
      event.patientId === patientId &&
      event.executed === false &&
      event.cancelled !== true
    ) {
      event.cancelled = true;
    }
  });
}
export function setScenarioTriggerMinute(
  eventId: string,
  triggerMinute: number
): void {
  const event = scenarioEvents.find(
    (event) => event.id === eventId
  );

  if (event) {
    event.triggerMinute = triggerMinute;
  }
}
export function getAllPendingScenarioEvents(): ScenarioEvent[] {
  return scenarioEvents.filter(
    (event) => event.executed === false && event.cancelled !== true
  );
}
export function getUpcomingScenarioEvents(): ScenarioEvent[] {
  return scenarioEvents
    .filter((event) => !event.executed && event.cancelled !== true)
    .sort(
      (a, b) => a.triggerMinute - b.triggerMinute
    );
}
