import { ScenarioEvent } from "@/models/ScenarioEvent";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

function getScenarioEvents(): ScenarioEvent[] {
  return clinicalDataProvider.getScenarioEvents();
}

export function getPendingScenarioEvents(

  patientId: string

): ScenarioEvent[] {

  return getScenarioEvents().filter(

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

  const event = getScenarioEvents().find(

    (event) => event.id === eventId

  );

  if (event) {

    event.executed = true;
    event.resolvedAtMinute = resolvedAtMinute;

  }

}

export function addScenarioEvent(event: ScenarioEvent): void {
  getScenarioEvents().push(event);
}

export function clearScenarioEvents(): void {
  clinicalDataProvider.resetScenarioEvents();
}
export function cancelPendingScenarioEvents(
  patientId: string,
  resolvedAtMinute: number
): void {
  getScenarioEvents().forEach((event) => {
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
  const event = getScenarioEvents().find(
    (event) => event.id === eventId
  );

  if (event) {
    event.triggerMinute = triggerMinute;
  }
}
export function getAllPendingScenarioEvents(): ScenarioEvent[] {
  return getScenarioEvents().filter(
    (event) => event.executed === false && event.cancelled !== true
  );
}
export function getUpcomingScenarioEvents(): ScenarioEvent[] {
  return getScenarioEvents()
    .filter((event) => !event.executed && event.cancelled !== true)
    .sort(
      (a, b) => a.triggerMinute - b.triggerMinute
    );
}

export function getResolvedScenarioEvents(): ScenarioEvent[] {
  return getScenarioEvents()
    .filter((event) => event.executed || event.cancelled === true)
    .sort(
      (a, b) => (b.resolvedAtMinute ?? 0) - (a.resolvedAtMinute ?? 0)
    );
}
