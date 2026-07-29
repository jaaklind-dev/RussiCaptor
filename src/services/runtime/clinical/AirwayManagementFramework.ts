import type { AirwayRuntimeEvent, AirwayState, DefinitiveAirwayState, VentilationState } from "@/models/AirwayState";
import type { InterventionInstance } from "@/models/InterventionInstance";

const airwayByDefinition: Record<string, DefinitiveAirwayState> = {
  OROPHARYNGEAL_AIRWAY: "OPA", NASOPHARYNGEAL_AIRWAY: "NPA",
  SUPRAGLOTTIC_IGEL: "SUPRAGLOTTIC", SUPRAGLOTTIC_LMA: "SUPRAGLOTTIC",
  ENDOTRACHEAL_INTUBATION: "ENDOTRACHEAL",
};
const ventilationByDefinition: Record<string, VentilationState> = {
  BAG_VALVE_MASK_VENTILATION: "BVM", MECHANICAL_VENTILATION: "MECHANICAL",
};

export class AirwayManagementFramework {
  private readonly states = new Map<string, AirwayState>();
  private readonly eventLog: AirwayRuntimeEvent[] = [];

  reset(): void { this.states.clear(); this.eventLog.length = 0; }

  apply(instance: InterventionInstance): AirwayRuntimeEvent[] {
    const previous = this.states.get(instance.patientId) ?? {
      patientId: instance.patientId, activeAirway: "NONE", currentVentilation: "NONE",
      confirmed: false, updatedAt: instance.startedAt,
    };
    const starting = instance.status === "RUNNING";
    const timestamp = instance.endedAt ?? instance.startedAt;
    const airway = airwayByDefinition[instance.definitionId];
    const ventilation = ventilationByDefinition[instance.definitionId];
    const events: AirwayRuntimeEvent[] = [];
    let next: AirwayState = { ...previous, updatedAt: timestamp };
    const add = (eventType: AirwayRuntimeEvent["eventType"]) => events.push({
      eventType, timestamp, patientId: instance.patientId, interventionInstanceId: instance.instanceId,
      definitionId: instance.definitionId, airwayState: next.activeAirway, ventilationState: next.currentVentilation,
    });
    if (airway) {
      next = { ...next, activeAirway: starting ? airway : "NONE", confirmed: false };
      add(starting ? "AirwayInserted" : "AirwayRemoved");
      if (starting && instance.parameters.confirmation === true) {
        next = { ...next, confirmed: true };
        add("AirwayConfirmed");
      }
    }
    if (ventilation) {
      next = { ...next, currentVentilation: starting ? ventilation : "NONE" };
      add(starting ? "VentilationStarted" : "VentilationStopped");
    }
    if (instance.definitionId === "OXYGEN_THERAPY") {
      next = { ...next, activeOxygenDelivery: starting ? String(instance.parameters.deliveryInterface ?? "oxygen") : undefined };
    }
    this.states.set(instance.patientId, next);
    this.eventLog.push(...events);
    return structuredClone(events);
  }

  getState(patientId: string): AirwayState {
    return structuredClone(this.states.get(patientId) ?? {
      patientId, activeAirway: "NONE", currentVentilation: "NONE", confirmed: false, updatedAt: 0,
    });
  }

  snapshot(): { states: AirwayState[]; events: AirwayRuntimeEvent[] } {
    return {
      states: [...this.states.values()].sort((a, b) => a.patientId.localeCompare(b.patientId)).map(item => structuredClone(item)),
      events: structuredClone(this.eventLog),
    };
  }
}
