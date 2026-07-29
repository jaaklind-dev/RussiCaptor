import type {
  ClinicalResourceDefinition, ClinicalResourceType,
  InterventionResourceRequirement, ResourceAllocation, ResourceAllocationConfiguration,
  ResourceAllocationEvent, ResourceAllocationFailureReason, ResourceAllocationIntent,
  ResourceAllocationRequest, ResourceAllocationRuntimeState, ResourceAvailability,
} from "@/models/ResourceAllocation";
import { clinicalResourceTypes } from "@/models/ResourceAllocation";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export type ResourceAllocationDecision = {
  status: "ALLOCATED" | "WAITING" | "REJECTED" | "NO_OP";
  request?: ResourceAllocationRequest;
  allocation?: ResourceAllocation;
  allocationsStarted: ResourceAllocation[];
  events: ResourceAllocationEvent[];
  reason?: ResourceAllocationFailureReason;
};

const knownTypes = new Set<ClinicalResourceType>(clinicalResourceTypes);
const clone = <T>(value: T): T => structuredClone(value);

function definitionOrder(a: ClinicalResourceDefinition, b: ClinicalResourceDefinition): number {
  return a.resourceType.localeCompare(b.resourceType);
}

function allocationOrder(a: ResourceAllocation, b: ResourceAllocation): number {
  return a.createdAtTick - b.createdAtTick || a.allocationId.localeCompare(b.allocationId);
}

function requestStableOrder(a: ResourceAllocationRequest, b: ResourceAllocationRequest): number {
  return b.effectivePriority - a.effectivePriority || b.explicitPriority - a.explicitPriority ||
    b.patientPriority - a.patientPriority || a.requestedAtTick - b.requestedAtTick ||
    a.requestId.localeCompare(b.requestId);
}

function normalizeRequirements(requirements: readonly InterventionResourceRequirement[]): InterventionResourceRequirement[] {
  const result = new Map<string, InterventionResourceRequirement>();
  for (const requirement of requirements) {
    if (!knownTypes.has(requirement.resourceType)) throw new ResourceAllocationValidationError("UNKNOWN_RESOURCE_TYPE");
    if (!Number.isInteger(requirement.quantity) || requirement.quantity <= 0) {
      throw new ResourceAllocationValidationError("INVALID_REQUIREMENT");
    }
    const key = `${requirement.resourceType}\u0000${requirement.requiredFor}\u0000${Boolean(requirement.optional)}`;
    const previous = result.get(key);
    result.set(key, { ...requirement, quantity: (previous?.quantity ?? 0) + requirement.quantity });
  }
  return [...result.values()].sort((a, b) =>
    a.resourceType.localeCompare(b.resourceType) || a.requiredFor.localeCompare(b.requiredFor) ||
    Number(Boolean(a.optional)) - Number(Boolean(b.optional))
  );
}

export class ResourceAllocationValidationError extends Error {
  constructor(readonly reason: ResourceAllocationFailureReason) {
    super(reason);
  }
}

export class ResourceAllocationEngine {
  private readonly definitions = new Map<ClinicalResourceType, ClinicalResourceDefinition>();
  private readonly allocations = new Map<string, ResourceAllocation>();
  private readonly requests = new Map<string, ResourceAllocationRequest>();
  private readonly eventLog: ResourceAllocationEvent[] = [];
  private sequence = 0;
  private currentTick = 0;

  constructor(private readonly configuration: ResourceAllocationConfiguration, restored?: ResourceAllocationRuntimeState) {
    this.validateConfiguration(configuration);
    configuration.resources.forEach(item => this.definitions.set(item.resourceType, clone(item)));
    if (restored) this.restore(restored);
  }

  request(intent: ResourceAllocationIntent): ResourceAllocationDecision {
    this.assertTick(intent.requestedAtTick);
    const duplicate = [...this.requests.values()].find(item => item.interventionId === intent.interventionId);
    if (duplicate) {
      return duplicate.status === "ALLOCATED"
        ? { status: "NO_OP", request: clone(duplicate), allocation: this.allocationFor(duplicate), allocationsStarted: [], events: [], reason: "ALREADY_ALLOCATED" }
        : { status: "NO_OP", request: clone(duplicate), allocationsStarted: [], events: [], reason: duplicate.status === "CANCELLED" ? "REQUEST_CANCELLED" : undefined };
    }
    let requirements: InterventionResourceRequirement[];
    try {
      requirements = normalizeRequirements(intent.requirements);
    } catch (error) {
      const reason = error instanceof ResourceAllocationValidationError ? error.reason : "INVALID_REQUIREMENT";
      return { status: "REJECTED", allocationsStarted: [], events: [], reason };
    }
    if (requirements.some(item => !this.definitions.has(item.resourceType))) {
      return { status: "REJECTED", allocationsStarted: [], events: [], reason: "UNKNOWN_RESOURCE_TYPE" };
    }
    if (!intent.interventionId || !intent.patientId || !requirements.length ||
      !Number.isFinite(intent.explicitPriority ?? 0) || !Number.isFinite(intent.patientPriority ?? 0)) {
      return { status: "REJECTED", allocationsStarted: [], events: [], reason: "INVALID_REQUIREMENT" };
    }
    const requestId = `${intent.interventionId}:REQUEST:${this.nextSequence()}`;
    const request: ResourceAllocationRequest = {
      requestId, interventionId: intent.interventionId, patientId: intent.patientId, requirements,
      requestedAtTick: intent.requestedAtTick, explicitPriority: intent.explicitPriority ?? 0,
      patientPriority: intent.patientPriority ?? 0,
      effectivePriority: (intent.explicitPriority ?? 0) + (intent.patientPriority ?? 0), status: "WAITING",
    };
    this.requests.set(requestId, request);
    const events = [this.event("ResourceAllocationRequested", request, intent.requestedAtTick)];
    const allocation = this.tryAllocate(request, intent.requestedAtTick, events);
    if (allocation) return { status: "ALLOCATED", request: clone(this.requests.get(requestId)!), allocation: clone(allocation), allocationsStarted: [clone(allocation)], events };
    events.push(this.event("ResourceAllocationDeferred", request, intent.requestedAtTick, { reason: this.shortageReason(request) }),
      this.event("InterventionWaitingForResources", request, intent.requestedAtTick, { reason: this.shortageReason(request) }));
    return { status: "WAITING", request: clone(request), allocationsStarted: [], events };
  }

  release(allocationId: string, tick: number, reason: "EXPLICIT" | "COMPLETED" | "CANCELLED" = "EXPLICIT"): ResourceAllocationDecision {
    this.assertTick(tick);
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return { status: "NO_OP", allocationsStarted: [], events: [], reason: "ALLOCATION_NOT_FOUND" };
    if (allocation.status !== "ACTIVE") return { status: "NO_OP", allocation: clone(allocation), allocationsStarted: [], events: [] };
    const status = reason === "CANCELLED" ? "CANCELLED" as const : "RELEASED" as const;
    const released = { ...allocation, status, releasedAtTick: tick };
    this.allocations.set(allocationId, released);
    const request = this.requests.get(allocation.requestId)!;
    const events = [this.event(reason === "CANCELLED" ? "ResourceAllocationCancelled" : "ResourceAllocationReleased", request, tick,
      { allocation: released, releaseTick: tick, reason })];
    const started = this.reevaluate(tick, events);
    return { status: "ALLOCATED", allocation: clone(released), allocationsStarted: started.map(clone), events };
  }

  cancelIntervention(interventionId: string, tick: number): ResourceAllocationDecision {
    this.assertTick(tick);
    const request = [...this.requests.values()].find(item => item.interventionId === interventionId);
    if (!request) return { status: "NO_OP", allocationsStarted: [], events: [], reason: "INTERVENTION_NOT_FOUND" };
    if (request.status === "CANCELLED") return { status: "NO_OP", request: clone(request), allocationsStarted: [], events: [] };
    const allocation = request.allocationId ? this.allocations.get(request.allocationId) : undefined;
    if (allocation?.status === "ACTIVE") return this.release(allocation.allocationId, tick, "CANCELLED");
    if (request.status !== "WAITING") return { status: "NO_OP", request: clone(request), allocationsStarted: [], events: [] };
    const cancelled = { ...request, status: "CANCELLED" as const };
    this.requests.set(request.requestId, cancelled);
    const events = [this.event("ResourceAllocationCancelled", cancelled, tick, { reason: "CANCELLED" })];
    return { status: "NO_OP", request: clone(cancelled), allocationsStarted: [], events };
  }

  advanceTo(tick: number): ResourceAllocationDecision {
    this.assertTick(tick);
    const events: ResourceAllocationEvent[] = [];
    for (const allocation of [...this.allocations.values()].filter(item =>
      item.status === "ACTIVE" && item.expiresAtTick !== undefined && item.expiresAtTick <= tick
    ).sort(allocationOrder)) {
      const expired = { ...allocation, status: "EXPIRED" as const, releasedAtTick: allocation.expiresAtTick };
      this.allocations.set(allocation.allocationId, expired);
      const request = this.requests.get(allocation.requestId)!;
      events.push(this.event("ResourceAllocationExpired", request, allocation.expiresAtTick!, {
        allocation: expired, releaseTick: allocation.expiresAtTick, reason: "TIMED",
      }));
    }
    const started = events.length ? this.reevaluate(tick, events) : [];
    return { status: started.length ? "ALLOCATED" : "NO_OP", allocationsStarted: started.map(clone), events };
  }

  availability(): ResourceAvailability[] {
    const active = [...this.allocations.values()].filter(item => item.status === "ACTIVE");
    const waiting = [...this.requests.values()].filter(item => item.status === "WAITING");
    return [...this.definitions.values()].sort(definitionOrder).map(definition => {
      const allocated = active.flatMap(item => item.resources).filter(item => item.resourceType === definition.resourceType)
        .reduce((sum, item) => sum + item.quantity, 0);
      const patients = [...new Set(active.filter(item => item.resources.some(resource => resource.resourceType === definition.resourceType))
        .map(item => item.patientId))].sort();
      return {
        resourceType: definition.resourceType, total: definition.capacity, allocated,
        available: definition.capacity - allocated,
        waitingRequestCount: waiting.filter(item => item.requirements.some(req => req.resourceType === definition.resourceType && !req.optional)).length,
        activePatientIds: patients,
      };
    });
  }

  snapshot(): ResourceAllocationRuntimeState {
    return clone({
      configuration: { ...this.configuration, resources: [...this.definitions.values()].sort(definitionOrder) },
      allocations: [...this.allocations.values()].sort(allocationOrder),
      requests: [...this.requests.values()].sort((a, b) => a.requestId.localeCompare(b.requestId)),
      sequence: this.sequence, currentTick: this.currentTick,
      events: [...this.eventLog].sort((a, b) => a.sequence - b.sequence),
    });
  }

  hash(): string { return sha256Text(stableJson(this.snapshot())); }

  private tryAllocate(request: ResourceAllocationRequest, tick: number, events: ResourceAllocationEvent[]): ResourceAllocation | undefined {
    if (!this.canAllocate(request)) return undefined;
    const resources = request.requirements.filter(item => !item.optional || this.available(item.resourceType) >= item.quantity)
      .map(item => ({ resourceType: item.resourceType, quantity: item.quantity })).sort((a, b) => a.resourceType.localeCompare(b.resourceType));
    const timedDurations = resources.map(item => this.definitions.get(item.resourceType)!)
      .filter(item => item.releaseMode === "TIMED").map(item => item.defaultAllocationDurationTicks!);
    const allocationId = `${request.requestId}:ALLOCATION:${this.nextSequence()}`;
    const allocation: ResourceAllocation = {
      allocationId, requestId: request.requestId, interventionId: request.interventionId,
      patientId: request.patientId, resources, createdAtTick: tick, effectiveAtTick: tick,
      ...(timedDurations.length ? { expiresAtTick: tick + Math.min(...timedDurations) } : {}), status: "ACTIVE",
    };
    this.allocations.set(allocationId, allocation);
    const allocatedRequest = { ...request, status: "ALLOCATED" as const, allocationId };
    this.requests.set(request.requestId, allocatedRequest);
    events.push(this.event("ResourceAllocationSucceeded", allocatedRequest, tick, { allocation, allocationTick: tick }),
      this.event("InterventionStartedAfterResourceAllocation", allocatedRequest, tick, { allocation, allocationTick: tick }));
    return allocation;
  }

  private reevaluate(tick: number, events: ResourceAllocationEvent[]): ResourceAllocation[] {
    const waiting = [...this.requests.values()].filter(item => item.status === "WAITING").map(request => {
      const aged = request.explicitPriority + request.patientPriority +
        Math.floor((tick - request.requestedAtTick) / this.configuration.fairness.ageingIntervalTicks) * this.configuration.fairness.ageingPriorityStep;
      if (aged !== request.effectivePriority) {
        const updated = { ...request, effectivePriority: aged };
        this.requests.set(request.requestId, updated);
        events.push(this.event("ResourceQueuePriorityChanged", updated, tick));
        return updated;
      }
      return request;
    }).sort(requestStableOrder);
    const started: ResourceAllocation[] = [];
    for (const request of waiting) {
      const allocation = this.tryAllocate(request, tick, events);
      if (allocation) started.push(allocation);
    }
    return started;
  }

  private canAllocate(request: ResourceAllocationRequest): boolean {
    return request.requirements.filter(item => !item.optional).every(item => this.available(item.resourceType) >= item.quantity);
  }

  private shortageReason(request: ResourceAllocationRequest): ResourceAllocationFailureReason {
    return request.requirements.some(item => !item.optional && (this.definitions.get(item.resourceType)?.capacity ?? 0) === 0)
      ? "RESOURCE_UNAVAILABLE" : "INSUFFICIENT_CAPACITY";
  }

  private available(type: ClinicalResourceType): number {
    const total = this.definitions.get(type)?.capacity ?? 0;
    const allocated = [...this.allocations.values()].filter(item => item.status === "ACTIVE")
      .flatMap(item => item.resources).filter(item => item.resourceType === type).reduce((sum, item) => sum + item.quantity, 0);
    return total - allocated;
  }

  private allocationFor(request: ResourceAllocationRequest): ResourceAllocation | undefined {
    const allocation = request.allocationId ? this.allocations.get(request.allocationId) : undefined;
    return allocation ? clone(allocation) : undefined;
  }

  private event(type: ResourceAllocationEvent["eventType"], request: ResourceAllocationRequest, tick: number,
    details: { allocation?: ResourceAllocation; allocationTick?: number; releaseTick?: number; reason?: ResourceAllocationEvent["reason"] } = {}
  ): ResourceAllocationEvent {
    const event: ResourceAllocationEvent = {
      eventType: type, sequence: this.nextSequence(), tick, requestId: request.requestId,
      interventionId: request.interventionId, patientId: request.patientId,
      allocationId: details.allocation?.allocationId ?? request.allocationId,
      resources: details.allocation?.resources ?? request.requirements.map(item => ({ resourceType: item.resourceType, quantity: item.quantity })),
      requestedAtTick: request.requestedAtTick, allocationTick: details.allocationTick,
      releaseTick: details.releaseTick, reason: details.reason,
    };
    this.eventLog.push(event);
    return clone(event);
  }

  private nextSequence(): number { this.sequence += 1; return this.sequence; }
  private assertTick(tick: number): void {
    if (!Number.isInteger(tick) || tick < this.currentTick) throw new ResourceAllocationValidationError("INVALID_REQUIREMENT");
    this.currentTick = tick;
  }

  private validateConfiguration(configuration: ResourceAllocationConfiguration): void {
    if (!configuration.version || !Number.isInteger(configuration.fairness.ageingIntervalTicks) || configuration.fairness.ageingIntervalTicks <= 0 ||
      !Number.isFinite(configuration.fairness.ageingPriorityStep) || configuration.fairness.ageingPriorityStep < 0) {
      throw new ResourceAllocationValidationError("INVALID_CONFIGURATION");
    }
    const seen = new Set<string>();
    for (const definition of configuration.resources) {
      if (!knownTypes.has(definition.resourceType) || seen.has(definition.resourceType) || !Number.isInteger(definition.capacity) || definition.capacity < 0 ||
        !["EXCLUSIVE", "CAPACITY"].includes(definition.allocationMode) ||
        !["EXPLICIT", "ON_INTERVENTION_END", "TIMED"].includes(definition.releaseMode) ||
        (definition.releaseMode === "TIMED" && (!Number.isInteger(definition.defaultAllocationDurationTicks) || definition.defaultAllocationDurationTicks! <= 0))) {
        throw new ResourceAllocationValidationError("INVALID_CONFIGURATION");
      }
      seen.add(definition.resourceType);
    }
  }

  private restore(restored: ResourceAllocationRuntimeState): void {
    const canonicalConfiguration = {
      ...this.configuration,
      resources: [...this.configuration.resources].sort(definitionOrder),
    };
    if (stableJson(restored.configuration) !== stableJson(canonicalConfiguration)) throw new ResourceAllocationValidationError("INVALID_CONFIGURATION");
    restored.allocations.forEach(item => this.allocations.set(item.allocationId, clone(item)));
    restored.requests.forEach(item => this.requests.set(item.requestId, clone(item)));
    this.eventLog.push(...restored.events.map(clone));
    this.sequence = restored.sequence;
    this.currentTick = restored.currentTick;
    const invalid = this.availability().some(item => item.allocated < 0 || item.available < 0 || item.available > item.total);
    if (invalid) throw new ResourceAllocationValidationError("INVALID_CONFIGURATION");
  }
}
