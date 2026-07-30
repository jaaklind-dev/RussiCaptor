export type SyncSource = "local" | "remote" | "device";

type SyncListener = (source: SyncSource) => void;

const listeners: SyncListener[] = [];
let version = 0;

export function getSyncVersion(): number {
  return version;
}

export function subscribeToSync(
  listener: SyncListener
): () => void {
  listeners.push(listener);

  return () => {
    const index = listeners.indexOf(listener);

    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

export function notifySync(source: SyncSource = "local"): void {
  version += 1;
  listeners.forEach((listener) => listener(source));
}
