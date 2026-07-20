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
  eventId: string,
  resolvedAtMinute: number

): void {

  const event = scenarioEvents.find(

    (event) => event.id === eventId

  );

  if (event) {

    event.executed = true;
    event.resolvedAtMinute = resolvedAtMinute;

  }

}

export function addScenarioEvent(event: ScenarioEvent): void {
  scenarioEvents.push(event);
}

export function clearScenarioEvents(): void {
  scenarioEvents.splice(0, scenarioEvents.length);
}
export function cancelPendingScenarioEvents(
  patientId: string,
  resolvedAtMinute: number
): void {
  scenarioEvents.forEach((event) => {
    if (
      event.patientId === patientId &&
      event.executed === false &&
      event.cancelled !== true
    ) {
      event.cancelled = true;
      event.resolvedAtMinute = resolvedAtMinute;
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

export function getResolvedScenarioEvents(): ScenarioEvent[] {
  return scenarioEvents
    .filter((event) => event.executed || event.cancelled === true)
    .sort(
      (a, b) => (b.resolvedAtMinute ?? 0) - (a.resolvedAtMinute ?? 0)
    );
}
