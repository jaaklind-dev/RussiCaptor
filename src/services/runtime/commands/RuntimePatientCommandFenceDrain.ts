export type RuntimePatientCommandFenceTraceEvent =
  | "COMPLETION_COMMAND_FENCE_CHECK"
  | "COMPLETION_COMMAND_DRAIN_WAIT"
  | "COMPLETION_COMMAND_DRAIN_COMPLETE";

export type RuntimePatientCommandFenceTrace = (
  event: RuntimePatientCommandFenceTraceEvent,
  detail: Readonly<{
    cursor: number;
    fence: number;
    alreadySatisfied: boolean;
  }>,
) => void;

type RuntimePatientCommandFenceDrainOptions = Readonly<{
  fence: number;
  currentCursor: () => number;
  drain: () => Promise<number>;
  isCurrentWriter: () => boolean;
  trace?: RuntimePatientCommandFenceTrace;
}>;

function assertSequence(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

/**
 * Drains patient commands through an inclusive completion fence.
 *
 * The cursor is the last command sequence fully recorded by the canonical
 * writer. The backend terminal-finalization contract rejects only a cursor
 * below the request fence, so equality is already drained. Recognizing that
 * state before entering the consumer is important: the consumer may perform
 * canonical reconciliation even when no newer command exists, and completion
 * fencing deliberately prevents its ordinary publication path.
 */
export async function drainRuntimePatientCommandsThroughFence(
  options: RuntimePatientCommandFenceDrainOptions,
): Promise<number> {
  assertSequence(options.fence, "INVALID_RUNTIME_COMMAND_FENCE");
  let cursor = options.currentCursor();
  assertSequence(cursor, "INVALID_RUNTIME_COMMAND_CURSOR");
  const alreadySatisfied = cursor >= options.fence;
  options.trace?.("COMPLETION_COMMAND_FENCE_CHECK", {
    cursor,
    fence: options.fence,
    alreadySatisfied,
  });
  if (alreadySatisfied) {
    options.trace?.("COMPLETION_COMMAND_DRAIN_COMPLETE", {
      cursor,
      fence: options.fence,
      alreadySatisfied: true,
    });
    return cursor;
  }

  options.trace?.("COMPLETION_COMMAND_DRAIN_WAIT", {
    cursor,
    fence: options.fence,
    alreadySatisfied: false,
  });
  let previous = -1;
  do {
    if (!options.isCurrentWriter()) throw new Error("RUNTIME_COMMAND_FENCE_WRITER_LOST");
    previous = cursor;
    cursor = await options.drain();
    assertSequence(cursor, "INVALID_RUNTIME_COMMAND_CURSOR");
    if (!options.isCurrentWriter()) throw new Error("RUNTIME_COMMAND_FENCE_WRITER_LOST");
  } while (cursor < options.fence && cursor > previous);

  if (cursor < options.fence) throw new Error("RUNTIME_COMMAND_FENCE_NOT_DRAINED");
  options.trace?.("COMPLETION_COMMAND_DRAIN_COMPLETE", {
    cursor,
    fence: options.fence,
    alreadySatisfied: false,
  });
  return cursor;
}
