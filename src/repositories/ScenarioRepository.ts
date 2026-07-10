import { scenarioEvents } from "@/data/scenarioEvents";

import { ScenarioEvent } from "@/models/ScenarioEvent";

export function getPendingScenarioEvents(

  patientId: string

): ScenarioEvent[] {

  return scenarioEvents.filter(

    (event) =>

      event.patientId === patientId &&

      event.executed === false

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
    (event) => event.executed === false
  );
}