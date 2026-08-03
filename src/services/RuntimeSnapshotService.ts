import type { RuntimeState } from "@/models/RuntimeAggregation";

type Listener = () => void;

export type RuntimeProcessProjection = {
  readonly processId: string;
  readonly moduleId: string;
  readonly status: "Active" | "Controlled" | "Resolved" | "Cancelled";
};

export type CanonicalPatientRuntimeSnapshot = {
  readonly state: RuntimeState;
  readonly processes: readonly RuntimeProcessProjection[];
};

const states = new Map<string, CanonicalPatientRuntimeSnapshot>();
const listeners = new Set<Listener>();
let version = 0;

/** Publishes an immutable copy for read-only runtime consumers such as the ExCon workspace. */
export function publishRuntimeSnapshot(state: RuntimeState, processes?: readonly RuntimeProcessProjection[]): void {
  const previous = states.get(state.encounterId);
  states.set(state.encounterId, structuredClone({
    state,
    processes: processes ?? previous?.processes ?? [],
  }));
  version += 1;
  listeners.forEach(listener => listener());
}

export function getRuntimeSnapshots(): RuntimeState[] {
  return [...states.values()]
    .sort((a, b) => a.state.encounterId.localeCompare(b.state.encounterId))
    .map(snapshot => structuredClone(snapshot.state));
}

export function getCanonicalPatientRuntimeSnapshot(patientId: string): CanonicalPatientRuntimeSnapshot | undefined {
  const snapshot = states.get(patientId);
  return snapshot ? structuredClone(snapshot) : undefined;
}

export function getRuntimeSnapshotVersion(): number {
  return version;
}

export function subscribeToRuntimeSnapshots(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearRuntimeSnapshots(): void {
  if (states.size === 0) return;
  states.clear();
  version += 1;
  listeners.forEach(listener => listener());
}
