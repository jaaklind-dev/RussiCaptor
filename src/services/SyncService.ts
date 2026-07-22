export type SyncSource = "local" | "remote";

type SyncListener = (source: SyncSource) => void;

const listeners: SyncListener[] = [];

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
  listeners.forEach((listener) => listener(source));
}
