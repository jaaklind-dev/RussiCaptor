import type {
  InterventionRejectionReason,
  ResourceRuntimeEvent,
  RuntimeIntervention,
  SchedulableIntervention,
} from "@/models/ResourceRuntime";
import { ResourcePool } from "@/services/runtime/ResourcePool";

type Rejection = {
  reasonCode: InterventionRejectionReason;
  conflictingInterventionId?: string;
  exclusiveGroup?: string;
};

function actionPhase(action: RuntimeIntervention["action"]): number {
  return action === "REMOVE" ? 0 : 1;
}

function compareInterventions(left: RuntimeIntervention, right: RuntimeIntervention): number {
  return left.timestamp - right.timestamp ||
    right.priority - left.priority ||
    actionPhase(left.action) - actionPhase(right.action) ||
    left.interventionId.localeCompare(right.interventionId);
}

/** @deprecated Compatibility runtime for pre-WP-18 scenarios. New resource-aware writes use ResourceAwareInterventionRuntime. */
export class InterventionEngine {
  private readonly pending = new Map<string, RuntimeIntervention>();
  private readonly completed = new Set<string>();
  private readonly active = new Map<string, RuntimeIntervention>();

  schedule(intervention: SchedulableIntervention): void {
    if (this.pending.has(intervention.interventionId) || this.completed.has(intervention.interventionId)) {
      throw new Error(`Intervention ${intervention.interventionId} esineb mitu korda.`);
    }
    if (!Number.isFinite(intervention.timestamp) || intervention.timestamp < 0) {
      throw new Error("Intervention timestamp peab olema mittenegatiivne arv.");
    }
    const priority = intervention.priority ?? 0;
    if (!Number.isFinite(priority)) throw new Error("Intervention priority peab olema arv.");
    this.pending.set(intervention.interventionId, structuredClone({ ...intervention, priority }));
  }

  applyDue(timestamp: number, pool: ResourcePool): ResourceRuntimeEvent[] {
    const due = [...this.pending.values()]
      .filter(intervention => intervention.timestamp <= timestamp)
      .sort(compareInterventions);
    const rejections = this.preflight(due, pool);
    const events: ResourceRuntimeEvent[] = [];
    for (const intervention of due) {
      const rejection = rejections.get(intervention.interventionId);
      if (rejection) {
        events.push(this.rejectedEvent(intervention, rejection));
      } else if (intervention.action === "APPLY") {
        pool.reserve(intervention.resourceId, intervention.patientId);
        this.active.set(`${intervention.patientId}\u0000${intervention.resourceId}`, intervention);
        events.push(this.event("ResourceReserved", intervention), this.event("InterventionApplied", intervention));
      } else {
        pool.release(intervention.resourceId);
        this.active.delete(`${intervention.patientId}\u0000${intervention.resourceId}`);
        events.push(this.event("ResourceReleased", intervention), this.event("InterventionRemoved", intervention));
      }
      this.pending.delete(intervention.interventionId);
      this.completed.add(intervention.interventionId);
    }
    return events;
  }

  snapshot(): { pending: RuntimeIntervention[]; active: RuntimeIntervention[]; completed: string[] } {
    return {
      pending: [...this.pending.values()].sort(compareInterventions).map(item => structuredClone(item)),
      active: [...this.active.values()].sort(compareInterventions).map(item => structuredClone(item)),
      completed: [...this.completed].sort(),
    };
  }

  private preflight(due: RuntimeIntervention[], pool: ResourcePool): Map<string, Rejection> {
    const rejected = new Map<string, Rejection>();
    const groups = new Map<string, RuntimeIntervention[]>();
    for (const intervention of due) {
      const key = `${intervention.timestamp}\u0000${intervention.patientId}\u0000${intervention.resourceId}`;
      groups.set(key, [...(groups.get(key) ?? []), intervention]);
    }
    for (const interventions of groups.values()) {
      for (const action of ["REMOVE", "APPLY"] as const) {
        const sameAction = interventions.filter(item => item.action === action).sort(compareInterventions);
        const winner = sameAction[0];
        for (const loser of sameAction.slice(1)) {
          rejected.set(loser.interventionId, {
            reasonCode: loser.priority < winner.priority ? "LOWER_PRIORITY" : "DUPLICATE_ACTION",
            conflictingInterventionId: winner.interventionId,
          });
        }
      }
    }

    const resourceApplyGroups = new Map<string, RuntimeIntervention[]>();
    for (const intervention of due.filter(item => item.action === "APPLY" && !rejected.has(item.interventionId))) {
      const key = `${intervention.timestamp}\u0000${intervention.resourceId}`;
      resourceApplyGroups.set(key, [...(resourceApplyGroups.get(key) ?? []), intervention]);
    }
    for (const interventions of resourceApplyGroups.values()) {
      const sorted = interventions.sort(compareInterventions);
      const winner = sorted[0];
      for (const loser of sorted.slice(1)) {
        rejected.set(loser.interventionId, {
          reasonCode: loser.priority < winner.priority ? "LOWER_PRIORITY" : "RESOURCE_ALREADY_RESERVED",
          conflictingInterventionId: winner.interventionId,
        });
      }
    }

    const applyGroups = new Map<string, RuntimeIntervention[]>();
    for (const intervention of due.filter(item => item.action === "APPLY" && !rejected.has(item.interventionId))) {
      const resource = pool.getResource(intervention.resourceId);
      if (!resource) {
        rejected.set(intervention.interventionId, { reasonCode: "RESOURCE_ALREADY_RESERVED" });
        continue;
      }
      if (resource.exclusiveGroup) {
        const key = `${intervention.timestamp}\u0000${intervention.patientId}\u0000${resource.exclusiveGroup}`;
        applyGroups.set(key, [...(applyGroups.get(key) ?? []), intervention]);
      }
    }
    for (const [key, interventions] of applyGroups) {
      const sorted = interventions.sort(compareInterventions);
      const winner = sorted[0];
      const exclusiveGroup = key.split("\u0000").at(-1);
      for (const loser of sorted.slice(1)) {
        rejected.set(loser.interventionId, {
          reasonCode: loser.priority < winner.priority ? "LOWER_PRIORITY" : "EXCLUSIVE_GROUP_CONFLICT",
          conflictingInterventionId: winner.interventionId, exclusiveGroup,
        });
      }
    }

    for (const intervention of due.filter(item => !rejected.has(item.interventionId))) {
      const resource = pool.getResource(intervention.resourceId);
      if (intervention.action === "REMOVE") {
        if (!resource || resource.status !== "RESERVED" || resource.assignedPatientId !== intervention.patientId) {
          rejected.set(intervention.interventionId, { reasonCode: "INVALID_REMOVE" });
        }
        continue;
      }
      const sameTickRemove = due.find(item => item.action === "REMOVE" &&
        item.timestamp === intervention.timestamp && item.patientId === intervention.patientId &&
        item.resourceId === intervention.resourceId && !rejected.has(item.interventionId) &&
        compareInterventions(item, intervention) < 0);
      if (resource?.status === "RESERVED" && !sameTickRemove) {
        rejected.set(intervention.interventionId, {
          reasonCode: "RESOURCE_ALREADY_RESERVED",
          exclusiveGroup: resource.exclusiveGroup,
        });
      }
      if (resource?.exclusiveGroup) {
        const occupied = pool.getAssignedResources(intervention.patientId).find(item =>
          item.exclusiveGroup === resource.exclusiveGroup && item.resourceId !== resource.resourceId
        );
        const occupiedRemoved = occupied && due.some(item => item.action === "REMOVE" &&
          item.timestamp === intervention.timestamp && item.patientId === intervention.patientId &&
          item.resourceId === occupied.resourceId && !rejected.has(item.interventionId));
        if (occupied && !occupiedRemoved) {
          rejected.set(intervention.interventionId, {
            reasonCode: "EXCLUSIVE_GROUP_CONFLICT", exclusiveGroup: resource.exclusiveGroup,
          });
        }
      }
    }
    return rejected;
  }

  private event(eventType: ResourceRuntimeEvent["eventType"], intervention: RuntimeIntervention): ResourceRuntimeEvent {
    return {
      eventType, timestamp: intervention.timestamp, resourceId: intervention.resourceId,
      patientId: intervention.patientId, interventionId: intervention.interventionId,
      sourceProcessId: intervention.sourceProcessId,
      definitionId: intervention.definitionId,
      parameters: intervention.parameters ? structuredClone(intervention.parameters) : undefined,
    };
  }

  private rejectedEvent(intervention: RuntimeIntervention, rejection: Rejection): ResourceRuntimeEvent {
    return {
      ...this.event("InterventionRejected", intervention), ...rejection,
    };
  }
}
