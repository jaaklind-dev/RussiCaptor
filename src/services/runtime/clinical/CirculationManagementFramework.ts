import type { CirculationRuntimeEvent, CirculationState, VascularAccessType } from "@/models/CirculationState";
import type { InterventionInstance } from "@/models/InterventionInstance";

const accessTypes: Record<string, VascularAccessType> = {
  PERIPHERAL_IV_ACCESS: "PERIPHERAL_IV", INTRAOSSEOUS_ACCESS: "IO", CENTRAL_VENOUS_ACCESS: "CENTRAL_ACCESS",
};

export class CirculationManagementFramework {
  private readonly states = new Map<string, CirculationState>();
  private readonly events: CirculationRuntimeEvent[] = [];
  reset(): void { this.states.clear(); this.events.length = 0; }

  apply(instance: InterventionInstance): CirculationRuntimeEvent[] {
    const starting = instance.status === "RUNNING";
    const timestamp = instance.endedAt ?? instance.startedAt;
    const state = this.getState(instance.patientId);
    const emitted: CirculationRuntimeEvent[] = [];
    const emit = (eventType: CirculationRuntimeEvent["eventType"]) => emitted.push({ eventType, timestamp,
      patientId: instance.patientId, interventionInstanceId: instance.instanceId, definitionId: instance.definitionId });
    const accessType = accessTypes[instance.definitionId];
    if (accessType) {
      state.vascularAccess = starting
        ? [...state.vascularAccess.filter(item => item.interventionInstanceId !== instance.instanceId), {
          interventionInstanceId: instance.instanceId, type: accessType, resourceIds: [...instance.resourceIds],
          location: typeof instance.parameters.location === "string" ? instance.parameters.location : undefined,
          establishedAt: instance.startedAt,
        }].sort((a, b) => a.interventionInstanceId.localeCompare(b.interventionInstanceId))
        : state.vascularAccess.filter(item => item.interventionInstanceId !== instance.instanceId);
      emit(starting ? "VascularAccessEstablished" : "VascularAccessRemoved");
    }
    if (["CRYSTALLOID_INFUSION", "BLOOD_PRODUCT_ADMINISTRATION", "PRESSURE_INFUSION"].includes(instance.definitionId)) {
      state.runningInfusions = starting
        ? [...new Set([...state.runningInfusions, instance.instanceId])].sort()
        : state.runningInfusions.filter(id => id !== instance.instanceId);
      emit(starting ? "InfusionStarted" : "InfusionStopped");
    }
    if (instance.definitionId === "TOURNIQUET_APPLICATION") {
      state.hemorrhageControl = starting ? [...new Set([...state.hemorrhageControl, "TOURNIQUET" as const])].sort()
        : state.hemorrhageControl.filter(item => item !== "TOURNIQUET");
      emit(starting ? "TourniquetApplied" : "TourniquetRemoved");
    }
    if (instance.definitionId === "PELVIC_BINDER_APPLICATION") {
      state.hemorrhageControl = starting ? [...new Set([...state.hemorrhageControl, "PELVIC_BINDER" as const])].sort()
        : state.hemorrhageControl.filter(item => item !== "PELVIC_BINDER");
      emit(starting ? "PelvicBinderApplied" : "PelvicBinderRemoved");
    }
    state.updatedAt = timestamp; this.states.set(instance.patientId, state); this.events.push(...emitted);
    return structuredClone(emitted);
  }

  getState(patientId: string): CirculationState {
    return structuredClone(this.states.get(patientId) ?? { patientId, vascularAccess: [], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 });
  }
  snapshot(): { states: CirculationState[]; events: CirculationRuntimeEvent[] } {
    return { states: [...this.states.values()].sort((a, b) => a.patientId.localeCompare(b.patientId)).map(x => structuredClone(x)), events: structuredClone(this.events) };
  }
}
