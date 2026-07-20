import {
  getUpcomingScenarioEvents,
  setScenarioTriggerMinute,
} from "@/repositories/ScenarioRepository";
import { notifySync } from "@/services/SyncService";
import { runScenarioEvents } from "@/services/ScenarioEngine";

export function adjustScenarioEventTime(
  eventId: string,
  deltaMinutes: number
): void {
  const event = getUpcomingScenarioEvents().find(
    (item) => item.id === eventId
  );

  if (!event) {
    return;
  }

  const newMinute = Math.max(
    0,
    event.triggerMinute + deltaMinutes
  );

  setScenarioTriggerMinute(
    eventId,
    newMinute
  );

  notifySync();
}

export function triggerScenarioEventNow(
  eventId: string,
  currentMinute: number
): boolean {
  const event = getUpcomingScenarioEvents().find(
    (item) => item.id === eventId
  );

  if (!event) {
    return false;
  }

  setScenarioTriggerMinute(eventId, currentMinute);
  runScenarioEvents(currentMinute);

  return !getUpcomingScenarioEvents().some((item) => item.id === eventId);
}
