export class RuntimeCheckpointClockMismatchError extends Error {
  readonly expectedSimulationTimeSec: number;
  readonly observedRuntimeClocks: readonly number[];

  constructor(expectedSimulationTimeSec: number, observedRuntimeClocks: readonly number[]) {
    super("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
    this.name = "RuntimeCheckpointClockMismatchError";
    this.expectedSimulationTimeSec = expectedSimulationTimeSec;
    this.observedRuntimeClocks = Object.freeze([...observedRuntimeClocks]);
  }
}

export type TerminalClockReconciliationDecision = Readonly<{
  state: "RETRY_FROM_CANONICAL_CLOCK" | "UNSAFE_MISMATCH";
  preparationClockSec: number;
  canonicalClockSec: number;
  deltaSec: number;
}>;

type TerminalClockReconciliationInput = Readonly<{
  lifecycleState: string;
  preparationClockSec: number;
  canonicalClockSec: number;
  detachedRuntimeClocks: readonly number[];
  liveRuntimeClocks: readonly number[];
  retryAlreadyScheduled: boolean;
}>;

const validClock = (value: number): boolean => Number.isFinite(value) && value >= 0;

/**
 * Classifies only the cooperative-capture race where the canonical clock and
 * every live Runtime have advanced together after the projection snapshot was
 * detached. No state is mutated here: a safe result merely asks the existing
 * latest-generation pipeline to capture again from the now-stopped canonical
 * terminal boundary.
 */
export function terminalClockReconciliationDecision(
  input: TerminalClockReconciliationInput,
): TerminalClockReconciliationDecision {
  const deltaSec = input.canonicalClockSec - input.preparationClockSec;
  const unsafe = (): TerminalClockReconciliationDecision => Object.freeze({
    state: "UNSAFE_MISMATCH",
    preparationClockSec: input.preparationClockSec,
    canonicalClockSec: input.canonicalClockSec,
    deltaSec,
  });
  if (input.lifecycleState !== "COMPLETED" || input.retryAlreadyScheduled ||
    !validClock(input.preparationClockSec) || !validClock(input.canonicalClockSec) ||
    input.canonicalClockSec < input.preparationClockSec ||
    input.detachedRuntimeClocks.length < 1 ||
    input.detachedRuntimeClocks.length !== input.liveRuntimeClocks.length ||
    input.detachedRuntimeClocks.some(clock => !validClock(clock) ||
      clock < input.preparationClockSec || clock > input.canonicalClockSec) ||
    input.liveRuntimeClocks.some(clock => !validClock(clock) || clock !== input.canonicalClockSec) ||
    input.detachedRuntimeClocks.every(clock => clock === input.preparationClockSec)) {
    return unsafe();
  }
  return Object.freeze({
    state: "RETRY_FROM_CANONICAL_CLOCK",
    preparationClockSec: input.preparationClockSec,
    canonicalClockSec: input.canonicalClockSec,
    deltaSec,
  });
}
