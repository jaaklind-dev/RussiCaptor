import {
  getAllPendingScenarioEvents,

  markScenarioEventExecuted,
} from "@/repositories/ScenarioRepository";

import { notifySync } from "@/services/SyncService";

import { executeScenarioEvent } from "@/services/WorkflowExecutor";

export function runScenarioEvents(

  currentMinute: number

): void {

  const events = getAllPendingScenarioEvents();

  events.forEach((event) => {

    if (event.triggerMinute <= currentMinute) {

      executeScenarioEvent(event);

      markScenarioEventExecuted(event.id);

    }

  });

  notifySync();

}