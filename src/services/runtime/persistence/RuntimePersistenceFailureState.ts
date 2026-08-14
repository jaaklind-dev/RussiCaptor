export type RuntimePersistenceFailure = Readonly<{
  code: "ACTIVE_RUNTIME_PERSISTENCE_MISSING";
  exerciseId: string;
}>;

let current: RuntimePersistenceFailure | undefined;
let version = 0;
const listeners = new Set<() => void>();

export function getRuntimePersistenceFailure(): RuntimePersistenceFailure | undefined {
  return current ? Object.freeze({ ...current }) : undefined;
}
export function getRuntimePersistenceFailureVersion(): number { return version; }
export function subscribeToRuntimePersistenceFailure(listener: () => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
export function setRuntimePersistenceFailure(failure?: RuntimePersistenceFailure): void {
  if (current?.code === failure?.code && current?.exerciseId === failure?.exerciseId) return;
  current = failure ? Object.freeze({ ...failure }) : undefined;
  version += 1;
  listeners.forEach(listener => listener());
}
