type CompletionIntentListener = (active: boolean) => void;

export type RuntimeCompletionCheckpointIntent = Readonly<{
  exerciseId: string;
  commandId: string;
  generation: number;
  state: "PENDING" | "ACCEPTED";
}>;

const completionIntentListeners = new Set<CompletionIntentListener>();
let nextIntentGeneration = 0;
let activeIntent: RuntimeCompletionCheckpointIntent | undefined;

function notifyCompletionIntent(active: boolean): void {
  [...completionIntentListeners].forEach(listener => listener(active));
}

/**
 * Registers the per-exercise checkpoint coordinator that owns terminal
 * publication.  The command layer only announces intent; it never mutates
 * checkpoint authority itself.
 */
export function installRuntimeCompletionIntentListener(listener: CompletionIntentListener): () => void {
  completionIntentListeners.add(listener);
  if (activeIntent) listener(true);
  return () => completionIntentListeners.delete(listener);
}

export function getRuntimeCompletionCheckpointIntent(): RuntimeCompletionCheckpointIntent | undefined {
  return activeIntent ? Object.freeze({ ...activeIntent }) : undefined;
}

/**
 * Announces a validated COMPLETE command immediately before Runtime applies
 * it.  This lets an in-progress routine publication yield to the terminal
 * checkpoint before the potentially expensive lifecycle mutation returns.
 * The returned callback records Runtime acceptance or cancels the intent when
 * Runtime rejects/throws. Acceptance is not final settlement: the atomic
 * completion acknowledgement owns that later transition.
 */
export function beginRuntimeCompletionCheckpointIntent(
  exerciseId: string,
  commandId: string,
): (accepted: boolean) => void {
  const existing = activeIntent?.exerciseId === exerciseId && activeIntent.commandId === commandId
    ? activeIntent
    : undefined;
  const generation = existing?.generation ?? ++nextIntentGeneration;
  if (!existing) {
    activeIntent = Object.freeze({ exerciseId, commandId, generation, state: "PENDING" });
    notifyCompletionIntent(true);
  }
  let settled = false;
  return accepted => {
    if (settled) return;
    settled = true;
    if (activeIntent?.generation !== generation) return;
    if (accepted) {
      activeIntent = Object.freeze({ ...activeIntent, state: "ACCEPTED" });
      return;
    }
    activeIntent = undefined;
    notifyCompletionIntent(false);
  };
}

/**
 * Consumes the accepted lifecycle intent only after the atomic completion RPC
 * and its canonical terminal checkpoint have both been acknowledged. Matching
 * the full identity prevents an obsolete generation from settling newer work.
 */
export function settleRuntimeCompletionCheckpointIntent(exerciseId: string, commandId: string): boolean {
  if (activeIntent?.exerciseId !== exerciseId || activeIntent.commandId !== commandId) return false;
  activeIntent = undefined;
  notifyCompletionIntent(false);
  return true;
}

export function resetRuntimeCompletionCheckpointIntentForTests(): void {
  activeIntent = undefined;
  nextIntentGeneration = 0;
  completionIntentListeners.clear();
}
