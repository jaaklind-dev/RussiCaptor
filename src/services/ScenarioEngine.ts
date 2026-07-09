import {
  getPendingScenarioEvents,
  markScenarioEventExecuted,
} from "@/repositories/ScenarioRepository";

import { notifySync } from "@/services/SyncService";
import { executeScenarioEvent } from "@/services/WorkflowExecutor";

export function runScenarioEvents(patientId: string): void {
  const events = getPendingScenarioEvents(patientId);

  events.forEach((event) => {
    executeScenarioEvent(event);
    markScenarioEventExecuted(event.id);
  });

  notifySync();
}