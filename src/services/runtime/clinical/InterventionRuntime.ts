import type { ClinicalEffect, ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { InterventionDefinition } from "@/models/InterventionDefinition";
import type { InterventionInstance, InterventionFailureReason } from "@/models/InterventionInstance";
import type { ResourceRuntimeEvent, RuntimeResource } from "@/models/ResourceRuntime";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";

function inferredDefinition(resource: RuntimeResource | undefined): string | undefined {
  return resource?.type === "oxygenMask" ? "OXYGEN_THERAPY" : undefined;
}

function instanceOrder(left: InterventionInstance, right: InterventionInstance): number {
  return left.startedAt - right.startedAt || left.instanceId.localeCompare(right.instanceId);
}

export class InterventionRuntime {
  private readonly instances = new Map<string, InterventionInstance>();

  constructor(private readonly definitions: InterventionDefinitionRegistry) {}

  reset(): void {
    this.instances.clear();
  }

  consumeResourceEvent(
    event: ResourceRuntimeEvent,
    encounterId: string,
    resources: RuntimeResource[]
  ): InterventionInstance | undefined {
    if (event.eventType === "InterventionRejected") return undefined;
    if (event.eventType === "InterventionRemoved") return this.cancelForResource(event);
    if (event.eventType !== "InterventionApplied") return undefined;
    const resource = resources.find(item => item.resourceId === event.resourceId);
    const definitionId = event.definitionId ?? inferredDefinition(resource);
    if (!definitionId) return undefined;
    const definition = this.definitions.get(definitionId);
    if (!definition) return this.failed(event, encounterId, definitionId, "DEFINITION_NOT_FOUND");
    let parameters: Record<string, ClinicalParameterValue>;
    try {
      parameters = this.definitions.normalizeParameters(definition, event.parameters);
    } catch {
      return this.failed(event, encounterId, definitionId, "INVALID_PARAMETERS");
    }
    try {
      this.validatePreconditions(definition, encounterId, event.patientId, resources);
      const instance: InterventionInstance = {
        instanceId: `${event.interventionId ?? event.resourceId}:INSTANCE`,
        definitionId: definition.definitionId,
        definitionVersion: definition.version,
        definitionName: definition.name,
        encounterId,
        patientId: event.patientId,
        status: "RUNNING",
        startedAt: event.timestamp,
        parameters,
        resourceIds: resources.filter(item => item.assignedPatientId === event.patientId &&
          definition.requiredResources.some(required => required.resourceType === item.type))
          .map(item => item.resourceId).sort(),
        sourceInterventionId: event.interventionId ?? event.resourceId,
      };
      this.instances.set(instance.instanceId, instance);
      return structuredClone(instance);
    } catch {
      return this.failed(event, encounterId, definitionId, "REQUIRED_RESOURCE_MISSING");
    }
  }

  effectsAt(timestamp: number): ClinicalEffect[] {
    const effects: ClinicalEffect[] = [];
    for (const instance of this.active()) {
      const definition = this.definitions.get(instance.definitionId);
      if (!definition) continue;
      if (definition.duration.kind === "FIXED" && timestamp >= instance.startedAt + definition.duration.durationSec) {
        this.finish(instance.instanceId, "COMPLETED", instance.startedAt + definition.duration.durationSec);
        continue;
      }
      definition.effects.forEach((effect, index) => {
        const parameters: Record<string, ClinicalParameterValue> = {};
        for (const [target, source] of Object.entries(effect.parameterMap)) {
          if (instance.parameters[source] !== undefined) parameters[target] = instance.parameters[source];
        }
        effects.push({
          effectId: `${instance.instanceId}:${timestamp}:${index}`,
          effectType: effect.effectType,
          encounterId: instance.encounterId,
          patientId: instance.patientId,
          timestamp,
          sourceInterventionInstanceId: instance.instanceId,
          parameters,
          ...(definition.duration.kind === "FIXED" ? { duration: definition.duration.durationSec } : {}),
        });
      });
    }
    return effects.sort((a, b) =>
      a.timestamp - b.timestamp || a.effectType.localeCompare(b.effectType) || a.effectId.localeCompare(b.effectId)
    );
  }

  active(patientId?: string): InterventionInstance[] {
    return [...this.instances.values()].filter(item => item.status === "RUNNING" && (!patientId || item.patientId === patientId))
      .sort(instanceOrder).map(item => structuredClone(item));
  }

  snapshot(): InterventionInstance[] {
    return [...this.instances.values()].sort(instanceOrder).map(item => structuredClone(item));
  }

  forPatient(patientId: string): InterventionInstance[] {
    return this.snapshot().filter(item => item.patientId === patientId);
  }

  private validatePreconditions(
    definition: InterventionDefinition,
    encounterId: string,
    patientId: string,
    resources: RuntimeResource[]
  ): void {
    if (!encounterId && definition.preconditions.some(item => item.kind === "ACTIVE_ENCOUNTER")) {
      throw new Error("Active encounter puudub.");
    }
    for (const precondition of definition.preconditions) {
      if (precondition.kind === "RESOURCE_ASSIGNED_TO_PATIENT" && !resources.some(item =>
        item.type === precondition.resourceType && item.status === "RESERVED" && item.assignedPatientId === patientId
      )) throw new Error(`Precondition resource ${precondition.resourceType} puudub.`);
    }
    this.validateResources(definition, patientId, resources);
  }

  private validateResources(definition: InterventionDefinition, patientId: string, resources: RuntimeResource[]): void {
    for (const requirement of definition.requiredResources.filter(item => !item.optional)) {
      const count = resources.filter(item => item.type === requirement.resourceType && item.status === "RESERVED" &&
        item.assignedPatientId === patientId).length;
      if (count < requirement.quantity) throw new Error(`Required resource ${requirement.resourceType} puudub.`);
    }
  }

  private cancelForResource(event: ResourceRuntimeEvent): InterventionInstance | undefined {
    const instance = this.active(event.patientId).find(item => item.resourceIds.includes(event.resourceId));
    return instance ? this.finish(instance.instanceId, "CANCELLED", event.timestamp) : undefined;
  }

  private finish(instanceId: string, status: "COMPLETED" | "CANCELLED", endedAt: number): InterventionInstance {
    const current = this.instances.get(instanceId);
    if (!current || current.status !== "RUNNING") throw new Error(`InterventionInstance ${instanceId} pole RUNNING.`);
    const finished: InterventionInstance = { ...current, status, endedAt };
    this.instances.set(instanceId, finished);
    return structuredClone(finished);
  }

  private failed(
    event: ResourceRuntimeEvent,
    encounterId: string,
    definitionId: string,
    failureReason: InterventionFailureReason
  ): InterventionInstance {
    const instance: InterventionInstance = {
      instanceId: `${event.interventionId ?? event.resourceId}:INSTANCE`, definitionId,
      definitionVersion: "UNKNOWN", definitionName: definitionId, encounterId,
      patientId: event.patientId, status: "FAILED", startedAt: event.timestamp, endedAt: event.timestamp,
      parameters: event.parameters ?? {}, resourceIds: [event.resourceId],
      sourceInterventionId: event.interventionId ?? event.resourceId, failureReason,
    };
    this.instances.set(instance.instanceId, instance);
    return structuredClone(instance);
  }
}
