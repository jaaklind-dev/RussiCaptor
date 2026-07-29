import type { ResourceRuntimeEvent, RuntimeIntervention, RuntimeResource } from "@/models/ResourceRuntime";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { AirwayState } from "@/models/AirwayState";

export type ResourceRuntimeDebugSnapshot = {
  resources: RuntimeResource[];
  activeInterventions: RuntimeIntervention[];
  clinicalInterventions?: InterventionInstance[];
  airwayStates?: AirwayState[];
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
    activeInterventions: snapshot.activeInterventions
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    clinicalInterventions: (snapshot.clinicalInterventions ?? [])
      .filter(intervention => intervention.patientId === patientId)
      .map(intervention => structuredClone(intervention)),
    airwayStates: (snapshot.airwayStates ?? [])
      .filter(state => state.patientId === patientId)
      .map(state => structuredClone(state)),
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
