import type { ResourceRuntimeEvent, RuntimeIntervention, RuntimeResource } from "@/models/ResourceRuntime";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { AirwayState } from "@/models/AirwayState";
import type { CirculationState } from "@/models/CirculationState";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { MedicationInstance, MedicationRuntimeEvent } from "@/models/MedicationRuntime";
import type { VitalSignState } from "@/models/VitalSign";
import type { ResourceAllocationRuntimeState } from "@/models/ResourceAllocation";

export type ResourceRuntimeDebugSnapshot = {
  resources: RuntimeResource[];
  allocationState?: ResourceAllocationRuntimeState;
  activeInterventions: RuntimeIntervention[];
  clinicalInterventions?: InterventionInstance[];
  airwayStates?: AirwayState[];
  circulationStates?: CirculationState[];
  hemorrhageProcesses?: HemorrhagePatientProcessRuntime[];
  medicationState?: { instances: MedicationInstance[]; events: MedicationRuntimeEvent[]; effects: ClinicalEffect[] };
  vitalSignStates?: { patientId: string; state: VitalSignState }[];
  recentEvents: ResourceRuntimeEvent[];
  updatedAt: number;
};

type Listener = () => void;
let snapshot: ResourceRuntimeDebugSnapshot = {
  resources: [], activeInterventions: [], recentEvents: [], updatedAt: 0,
};
let version = 0;
const listeners = new Set<Listener>();

export function publishResourceRuntimeDebugSnapshot(next: ResourceRuntimeDebugSnapshot): void {
  snapshot = structuredClone(next);
  version += 1;
  listeners.forEach(listener => listener());
}

export function getResourceRuntimeDebugVersion(): number {
  return version;
}

export function getPatientResourceDebugSnapshot(patientId: string): ResourceRuntimeDebugSnapshot {
  return {
    resources: snapshot.resources.map(resource => structuredClone(resource)),
    allocationState: snapshot.allocationState ? structuredClone(snapshot.allocationState) : undefined,
    activeInterventions: snapshot.activeInterventions
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    clinicalInterventions: (snapshot.clinicalInterventions ?? [])
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    airwayStates: (snapshot.airwayStates ?? [])
      .filter(state => state.patientId === patientId)
      .map(state => structuredClone(state)),
    circulationStates: (snapshot.circulationStates ?? [])
      .filter(state => state.patientId === patientId).map(state => structuredClone(state)),
    hemorrhageProcesses: (snapshot.hemorrhageProcesses ?? [])
      .filter(process => process.encounterId === patientId).map(process => structuredClone(process)),
    medicationState: snapshot.medicationState ? {
      instances: snapshot.medicationState.instances.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
      events: snapshot.medicationState.events.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
      effects: snapshot.medicationState.effects.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
    } : undefined,
    vitalSignStates: (snapshot.vitalSignStates ?? []).filter(item => item.patientId === patientId).map(item => structuredClone(item)),
    recentEvents: snapshot.recentEvents
      .filter(event => event.patientId === patientId)
      .slice(-10)
      .reverse()
      .map(event => structuredClone(event)),
    updatedAt: snapshot.updatedAt,
  };
}

export function getResourceRuntimeDebugSnapshot(): ResourceRuntimeDebugSnapshot {
  return structuredClone(snapshot);
}

export function subscribeToResourceRuntimeDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
