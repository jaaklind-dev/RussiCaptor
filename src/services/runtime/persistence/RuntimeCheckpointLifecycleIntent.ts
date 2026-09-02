type CompletionIntentListener = (active: boolean) => void;

const completionIntentListeners = new Set<CompletionIntentListener>();

/**
 * Registers the per-exercise checkpoint coordinator that owns terminal
 * publication.  The command layer only announces intent; it never mutates
 * checkpoint authority itself.
 */
export function installRuntimeCompletionIntentListener(listener: CompletionIntentListener): () => void {
  completionIntentListeners.add(listener);
  return () => completionIntentListeners.delete(listener);
}

/**
 * Announces a validated COMPLETE command immediately before Runtime applies
 * it.  This lets an in-progress routine publication yield to the terminal
 * checkpoint before the potentially expensive lifecycle mutation returns.
 * The returned callback must cancel the intent when Runtime rejects/throws.
 */
export function beginRuntimeCompletionCheckpointIntent(): (accepted: boolean) => void {
  const listeners = [...completionIntentListeners];
  listeners.forEach(listener => listener(true));
  let settled = false;
  return accepted => {
    if (settled) return;
    settled = true;
    if (!accepted) listeners.forEach(listener => listener(false));
  };
}
