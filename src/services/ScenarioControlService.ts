import {
  getUpcomingScenarioEvents,
  setScenarioTriggerMinute,
} from "@/repositories/ScenarioRepository";
import { notifySync } from "@/services/SyncService";

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
