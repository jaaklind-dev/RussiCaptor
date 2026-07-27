import type { ResourceRuntimeEvent, RuntimeIntervention } from "@/models/ResourceRuntime";
import { ResourcePool } from "@/services/runtime/ResourcePool";

export class InterventionEngine {
  private readonly pending = new Map<string, RuntimeIntervention>();
  private readonly completed = new Set<string>();

  schedule(intervention: RuntimeIntervention): void {
    if (this.pending.has(intervention.interventionId) || this.completed.has(intervention.interventionId)) {
      throw new Error(`Intervention ${intervention.interventionId} esineb mitu korda.`);
    }
    if (!Number.isFinite(intervention.timestamp) || intervention.timestamp < 0) {
      throw new Error("Intervention timestamp peab olema mittenegatiivne arv.");
    }
    this.pending.set(intervention.interventionId, structuredClone(intervention));
  }

  applyDue(timestamp: number, pool: ResourcePool): ResourceRuntimeEvent[] {
    const due = [...this.pending.values()]
      .filter(intervention => intervention.timestamp <= timestamp)
      .sort((a, b) => a.timestamp - b.timestamp || a.interventionId.localeCompare(b.interventionId));
    const events: ResourceRuntimeEvent[] = [];
    for (const intervention of due) {
      if (intervention.action === "APPLY") {
        pool.reserve(intervention.resourceId, intervention.patientId);
        events.push(this.event("ResourceReserved", intervention), this.event("InterventionApplied", intervention));
      } else {
        const assigned = pool.getAssignedResources(intervention.patientId)
          .some(resource => resource.resourceId === intervention.resourceId);
        if (!assigned) throw new Error(`Resource ${intervention.resourceId} pole patsiendile ${intervention.patientId} määratud.`);
        pool.release(intervention.resourceId);
        events.push(this.event("ResourceReleased", intervention), this.event("InterventionRemoved", intervention));
      }
      this.pending.delete(intervention.interventionId);
      this.completed.add(intervention.interventionId);
    }
    return events;
  }

  snapshot(): { pending: RuntimeIntervention[]; completed: string[] } {
    return {
      pending: [...this.pending.values()].sort((a, b) =>
        a.timestamp - b.timestamp || a.interventionId.localeCompare(b.interventionId)
      ).map(item => structuredClone(item)),
      completed: [...this.completed].sort(),
    };
  }

  private event(eventType: ResourceRuntimeEvent["eventType"], intervention: RuntimeIntervention): ResourceRuntimeEvent {
    return {
      eventType, timestamp: intervention.timestamp, resourceId: intervention.resourceId,
      patientId: intervention.patientId, interventionId: intervention.interventionId,
      sourceProcessId: intervention.sourceProcessId,
    };
  }
}
