import type { ClinicalEffect, ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { InterventionDefinition } from "@/models/InterventionDefinition";
import type { InterventionInstance, InterventionFailureReason } from "@/models/InterventionInstance";
import type { ResourceRuntimeEvent, RuntimeResource } from "@/models/ResourceRuntime";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";

function inferredDefinition(resource: RuntimeResource | undefined): string | undefined {
  return ({
    oxygenMask: "OXYGEN_THERAPY", simpleMask: "OXYGEN_THERAPY", nonRebreatherMask: "OXYGEN_THERAPY",
    nasalCannula: "OXYGEN_THERAPY", oropharyngealAirway: "OROPHARYNGEAL_AIRWAY",
    nasopharyngealAirway: "NASOPHARYNGEAL_AIRWAY", iGel: "SUPRAGLOTTIC_IGEL",
    laryngealMask: "SUPRAGLOTTIC_LMA", bagValveMask: "BAG_VALVE_MASK_VENTILATION",
    peripheralIV: "PERIPHERAL_IV_ACCESS", intraosseousAccess: "INTRAOSSEOUS_ACCESS",
    centralVenousCatheter: "CENTRAL_VENOUS_ACCESS", infusionPump: "CRYSTALLOID_INFUSION",
    bloodAdministrationSet: "BLOOD_PRODUCT_ADMINISTRATION", pressureBag: "PRESSURE_INFUSION",
    tourniquet: "TOURNIQUET_APPLICATION", pelvicBinder: "PELVIC_BINDER_APPLICATION",
  } as Partial<Record<RuntimeResource["type"], string>>)[resource?.type ?? "monitor"];
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

  startAllocated(input: {
    sourceInterventionId: string;
    definitionId: string;
    encounterId: string;
    patientId: string;
    startedAt: number;
    parameters?: Record<string, ClinicalParameterValue>;
    resourceIds: string[];
    clinicalContext?: Record<string, boolean>;
  }): InterventionInstance {
    const instanceId = `${input.sourceInterventionId}:INSTANCE`;
    const existing = this.instances.get(instanceId);
    if (existing) return structuredClone(existing);
    const definition = this.definitions.get(input.definitionId);
    if (!definition) {
      return this.storeFailed(input, "DEFINITION_NOT_FOUND");
    }
    let parameters: Record<string, ClinicalParameterValue>;
    try {
      parameters = this.definitions.normalizeParameters(definition, input.parameters);
      if (!input.encounterId && definition.preconditions.some(item => item.kind === "ACTIVE_ENCOUNTER")) {
        throw new Error("Active encounter puudub.");
      }
      for (const precondition of definition.preconditions) {
        if (precondition.kind === "CLINICAL_FLAG" && input.clinicalContext?.[precondition.flag] !== precondition.equals) {
          throw new Error(`Clinical precondition ${precondition.flag} ei ole täidetud.`);
        }
      }
    } catch {
      return this.storeFailed(input, "PRECONDITION_FAILED");
    }
    const instance: InterventionInstance = {
      instanceId, definitionId: definition.definitionId, definitionVersion: definition.version,
      definitionName: definition.name, encounterId: input.encounterId, patientId: input.patientId,
      status: "RUNNING", startedAt: input.startedAt, parameters,
      resourceIds: [...input.resourceIds].sort(), sourceInterventionId: input.sourceInterventionId,
    };
    this.instances.set(instanceId, instance);
    return structuredClone(instance);
  }

  finishBySource(sourceInterventionId: string, status: "COMPLETED" | "CANCELLED", endedAt: number): InterventionInstance | undefined {
    const instance = [...this.instances.values()].find(item =>
      item.sourceInterventionId === sourceInterventionId && item.status === "RUNNING"
    );
    return instance ? this.finish(instance.instanceId, status, endedAt) : undefined;
  }

  consumeResourceEvent(
    event: ResourceRuntimeEvent,
    encounterId: string,
    resources: RuntimeResource[]
    , clinicalContext: Record<string, boolean> = {}
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
      this.validatePreconditions(definition, encounterId, event.patientId, resources, clinicalContext);
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
    , clinicalContext: Record<string, boolean>
  ): void {
    if (!encounterId && definition.preconditions.some(item => item.kind === "ACTIVE_ENCOUNTER")) {
      throw new Error("Active encounter puudub.");
    }
    for (const precondition of definition.preconditions) {
      if (precondition.kind === "RESOURCE_ASSIGNED_TO_PATIENT" && !resources.some(item =>
        item.type === precondition.resourceType && item.status === "RESERVED" && item.assignedPatientId === patientId
      )) throw new Error(`Precondition resource ${precondition.resourceType} puudub.`);
      if (precondition.kind === "CLINICAL_FLAG" && clinicalContext[precondition.flag] !== precondition.equals) {
        throw new Error(`Clinical precondition ${precondition.flag} ei ole täidetud.`);
      }
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

  private storeFailed(
    input: { sourceInterventionId: string; definitionId: string; encounterId: string; patientId: string; startedAt: number;
      parameters?: Record<string, ClinicalParameterValue>; resourceIds: string[] },
    failureReason: InterventionFailureReason
  ): InterventionInstance {
    const instance: InterventionInstance = {
      instanceId: `${input.sourceInterventionId}:INSTANCE`, definitionId: input.definitionId,
      definitionVersion: "UNKNOWN", definitionName: input.definitionId, encounterId: input.encounterId,
      patientId: input.patientId, status: "FAILED", startedAt: input.startedAt, endedAt: input.startedAt,
      parameters: input.parameters ?? {}, resourceIds: [...input.resourceIds].sort(),
      sourceInterventionId: input.sourceInterventionId, failureReason,
    };
    this.instances.set(instance.instanceId, instance);
    return structuredClone(instance);
  }
}
