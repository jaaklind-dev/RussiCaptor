import type { RuntimeState } from "@/models/RuntimeAggregation";

type Listener = () => void;

const states = new Map<string, RuntimeState>();
const listeners = new Set<Listener>();
let version = 0;

/** Publishes an immutable copy for read-only runtime consumers such as Instructor Console. */
export function publishRuntimeSnapshot(state: RuntimeState): void {
  states.set(state.encounterId, structuredClone(state));
  version += 1;
  listeners.forEach(listener => listener());
}

export function getRuntimeSnapshots(): RuntimeState[] {
  return [...states.values()]
    .sort((a, b) => a.encounterId.localeCompare(b.encounterId))
    .map(state => structuredClone(state));
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
