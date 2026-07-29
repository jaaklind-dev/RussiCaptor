import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { ResourceAllocation, ResourceAllocationConfiguration } from "@/models/ResourceAllocation";
import type {
  ResourceAwareInterventionDefinition, ResourceAwareInterventionIntent,
  ResourceAwareInterventionLifecycle, ResourceAwareInterventionSnapshot,
} from "@/models/ResourceAwareIntervention";
import { ResourceAllocationEngine, type ResourceAllocationDecision } from "@/services/runtime/ResourceAllocationEngine";
import { InterventionRuntime } from "@/services/runtime/clinical/InterventionRuntime";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export type ResourceAwareInterventionResult = {
  readonly lifecycle: ResourceAwareInterventionLifecycle;
  readonly allocationDecision: ResourceAllocationDecision;
};

export class ResourceAwareInterventionRuntime {
  private readonly definitions = new Map<string, ResourceAwareInterventionDefinition>();
  private readonly lifecycle = new Map<string, ResourceAwareInterventionLifecycle>();
  private readonly allocationEngine: ResourceAllocationEngine;
  private readonly interventionRuntime: InterventionRuntime;

  constructor(
    configuration: ResourceAllocationConfiguration,
    clinicalDefinitions: InterventionDefinitionRegistry,
    allocationDefinitions: readonly ResourceAwareInterventionDefinition[],
    restored?: ResourceAwareInterventionSnapshot
  ) {
    allocationDefinitions.forEach(definition => {
      if (!clinicalDefinitions.get(definition.definitionId) || this.definitions.has(definition.definitionId)) {
        throw new Error(`Resource-aware intervention definition ${definition.definitionId} on vigane.`);
      }
      this.definitions.set(definition.definitionId, structuredClone(definition));
    });
    this.allocationEngine = new ResourceAllocationEngine(configuration, restored?.allocationState);
    this.interventionRuntime = new InterventionRuntime(clinicalDefinitions);
    restored?.lifecycle.forEach(item => this.lifecycle.set(item.interventionId, structuredClone(item)));
    for (const item of restored?.interventionInstances ?? []) {
      if (item.status === "RUNNING") {
        this.interventionRuntime.startAllocated({
          sourceInterventionId: item.sourceInterventionId, definitionId: item.definitionId,
          encounterId: item.encounterId, patientId: item.patientId, startedAt: item.startedAt,
          parameters: item.parameters, resourceIds: item.resourceIds,
        });
      }
    }
  }

  request(intent: ResourceAwareInterventionIntent): ResourceAwareInterventionResult {
    const definition = this.definitions.get(intent.definitionId);
    if (!definition) throw new Error(`Resource-aware definition ${intent.definitionId} puudub.`);
    const existing = this.lifecycle.get(intent.interventionId);
    if (existing) return { lifecycle: structuredClone(existing), allocationDecision: { status: "NO_OP", allocationsStarted: [], events: [] } };
    const requested: ResourceAwareInterventionLifecycle = {
      interventionId: intent.interventionId, definitionId: intent.definitionId,
      encounterId: intent.encounterId, patientId: intent.patientId, requestedAtTick: intent.requestedAtTick,
      status: "REQUESTED", parameters: structuredClone(intent.parameters ?? {}),
      clinicalContext: structuredClone(intent.clinicalContext ?? {}),
    };
    this.lifecycle.set(intent.interventionId, requested);
    const decision = this.allocationEngine.request({
      interventionId: intent.interventionId, patientId: intent.patientId,
      requirements: definition.resourceRequirements, requestedAtTick: intent.requestedAtTick,
      explicitPriority: intent.explicitPriority, patientPriority: intent.patientPriority,
    });
    if (decision.status === "ALLOCATED") this.activate(decision.allocation!);
    else this.lifecycle.set(intent.interventionId, {
      ...requested, status: decision.status === "WAITING" ? "WAITING_FOR_RESOURCES" : "FAILED",
    });
    return { lifecycle: structuredClone(this.lifecycle.get(intent.interventionId)!), allocationDecision: decision };
  }

  release(interventionId: string, tick: number, completed = true): ResourceAllocationDecision {
    const item = this.lifecycle.get(interventionId);
    if (!item?.allocationId) return { status: "NO_OP", allocationsStarted: [], events: [], reason: "ALLOCATION_NOT_FOUND" };
    this.interventionRuntime.finishBySource(interventionId, completed ? "COMPLETED" : "CANCELLED", tick);
    this.lifecycle.set(interventionId, { ...item, status: completed ? "COMPLETED" : "CANCELLED", endedAtTick: tick });
    const decision = this.allocationEngine.release(item.allocationId, tick, completed ? "COMPLETED" : "CANCELLED");
    decision.allocationsStarted.forEach(allocation => this.activate(allocation));
    return decision;
  }

  cancel(interventionId: string, tick: number): ResourceAllocationDecision {
    const item = this.lifecycle.get(interventionId);
    if (!item) return { status: "NO_OP", allocationsStarted: [], events: [], reason: "INTERVENTION_NOT_FOUND" };
    if (item.status === "RUNNING") return this.release(interventionId, tick, false);
    const decision = this.allocationEngine.cancelIntervention(interventionId, tick);
    if (item.status === "WAITING_FOR_RESOURCES") this.lifecycle.set(interventionId, { ...item, status: "CANCELLED", endedAtTick: tick });
    return decision;
  }

  advanceTo(tick: number): ResourceAllocationDecision {
    const before = this.allocationEngine.snapshot().allocations.filter(item => item.status === "ACTIVE" && item.expiresAtTick !== undefined && item.expiresAtTick <= tick);
    const decision = this.allocationEngine.advanceTo(tick);
    before.forEach(allocation => {
      const item = this.lifecycle.get(allocation.interventionId);
      if (item?.status === "RUNNING") {
        this.interventionRuntime.finishBySource(allocation.interventionId, "COMPLETED", allocation.expiresAtTick!);
        this.lifecycle.set(allocation.interventionId, { ...item, status: "COMPLETED", endedAtTick: allocation.expiresAtTick });
      }
    });
    decision.allocationsStarted.forEach(allocation => this.activate(allocation));
    return decision;
  }

  effectsAt(tick: number): ClinicalEffect[] {
    this.advanceTo(tick);
    const effects = this.interventionRuntime.effectsAt(tick);
    const instances = new Map(this.interventionRuntime.snapshot().map(item => [item.sourceInterventionId, item]));
    for (const item of [...this.lifecycle.values()]) {
      if (item.status !== "RUNNING" || instances.get(item.interventionId)?.status !== "COMPLETED") continue;
      this.release(item.interventionId, tick, true);
    }
    return effects;
  }

  snapshot(): ResourceAwareInterventionSnapshot {
    return structuredClone({
      allocationState: this.allocationEngine.snapshot(),
      lifecycle: [...this.lifecycle.values()].sort((a, b) => a.requestedAtTick - b.requestedAtTick || a.interventionId.localeCompare(b.interventionId)),
      interventionInstances: this.interventionRuntime.snapshot(),
    });
  }

  availability() { return this.allocationEngine.availability(); }
  hash(): string { return sha256Text(stableJson(this.snapshot())); }

  private activate(allocation: ResourceAllocation): void {
    const item = this.lifecycle.get(allocation.interventionId);
    if (!item || item.status === "RUNNING") return;
    this.lifecycle.set(item.interventionId, {
      ...item, status: "RESOURCES_ALLOCATED", allocationId: allocation.allocationId,
    });
    const instance = this.interventionRuntime.startAllocated({
      sourceInterventionId: item.interventionId, definitionId: item.definitionId,
      encounterId: item.encounterId, patientId: item.patientId, startedAt: allocation.effectiveAtTick,
      parameters: item.parameters,
      resourceIds: allocation.resources.map(resource => `${resource.resourceType}:${resource.quantity}`),
      clinicalContext: item.clinicalContext,
    });
    this.lifecycle.set(item.interventionId, {
      ...item, allocationId: allocation.allocationId, startedAtTick: allocation.effectiveAtTick,
      status: instance.status === "RUNNING" ? "RUNNING" : "FAILED",
      ...(instance.status === "FAILED" ? { endedAtTick: allocation.effectiveAtTick } : {}),
    });
    if (instance.status === "FAILED") {
      const released = this.allocationEngine.release(allocation.allocationId, allocation.effectiveAtTick, "CANCELLED");
      released.allocationsStarted.forEach(next => this.activate(next));
    }
  }
}
