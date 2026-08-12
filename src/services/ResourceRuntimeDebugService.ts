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
const patientSnapshots = new Map<string, ResourceRuntimeDebugSnapshot>();
let version = 0;
const listeners = new Set<Listener>();

export function publishResourceRuntimeDebugSnapshot(next: ResourceRuntimeDebugSnapshot, patientId?: string): void {
  snapshot = structuredClone(next);
  if (patientId) patientSnapshots.set(patientId, structuredClone(next));
  version += 1;
  listeners.forEach(listener => listener());
}

export function getResourceRuntimeDebugVersion(): number {
  return version;
}

export function getPatientResourceDebugSnapshot(patientId: string): ResourceRuntimeDebugSnapshot {
  const patientSnapshot = patientSnapshots.get(patientId) ?? snapshot;
  return {
    resources: patientSnapshot.resources.map(resource => structuredClone(resource)),
    allocationState: patientSnapshot.allocationState ? structuredClone(patientSnapshot.allocationState) : undefined,
    activeInterventions: patientSnapshot.activeInterventions
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    clinicalInterventions: (patientSnapshot.clinicalInterventions ?? [])
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    airwayStates: (patientSnapshot.airwayStates ?? [])
      .filter(state => state.patientId === patientId)
      .map(state => structuredClone(state)),
    circulationStates: (patientSnapshot.circulationStates ?? [])
      .filter(state => state.patientId === patientId).map(state => structuredClone(state)),
    hemorrhageProcesses: (patientSnapshot.hemorrhageProcesses ?? [])
      .filter(process => process.encounterId === patientId).map(process => structuredClone(process)),
    medicationState: patientSnapshot.medicationState ? {
      instances: patientSnapshot.medicationState.instances.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
      events: patientSnapshot.medicationState.events.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
      effects: patientSnapshot.medicationState.effects.filter(x => x.patientId === patientId).map(x=>structuredClone(x)),
    } : undefined,
    vitalSignStates: (patientSnapshot.vitalSignStates ?? []).filter(item => item.patientId === patientId).map(item => structuredClone(item)),
    recentEvents: patientSnapshot.recentEvents
      .filter(event => event.patientId === patientId)
      .slice(-10)
      .reverse()
      .map(event => structuredClone(event)),
    updatedAt: patientSnapshot.updatedAt,
  };
}

export function getResourceRuntimeDebugSnapshot(): ResourceRuntimeDebugSnapshot {
  return structuredClone(snapshot);
}

export function subscribeToResourceRuntimeDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
