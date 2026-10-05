type SignOutPreparation = () => Promise<void>;

export type OperatorSignOutDrainContext = Readonly<{
  exerciseId: string;
  writerInstanceId: string;
  leaseId: string;
  writerGeneration: number;
  checkpointRevision: number;
}>;

let preparation: SignOutPreparation | undefined;
let preparationInFlight: Promise<void> | undefined;
let drainContext: OperatorSignOutDrainContext | undefined;

/**
 * Runtime registers its authenticated teardown boundary here so Auth can wait
 * for canonical authority release without introducing an authorization/runtime
 * import cycle.
 */
export function registerOperatorSignOutPreparation(next: SignOutPreparation): () => void {
  preparation = next;
  return () => {
    if (preparation === next) preparation = undefined;
  };
}

/** Double taps share the same preparation and never issue duplicate release RPCs. */
export function prepareOperatorSignOut(): Promise<void> {
  if (preparationInFlight) return preparationInFlight;
  const current = preparation;
  if (!current) return drainContext
    ? Promise.reject(new Error("WRITER_SIGNOUT_PREPARATION_UNAVAILABLE"))
    : Promise.resolve();
  // Enter Runtime's drain synchronously in the same event turn as the tap.
  // Deferring this call left a window for reconnect/foreground acquisition.
  let task: Promise<void>;
  try { task = current(); }
  catch (error) { task = Promise.reject(error); }
  const inFlight = task.finally(() => {
    if (preparationInFlight === inFlight) preparationInFlight = undefined;
  });
  preparationInFlight = inFlight;
  return inFlight;
}

/** Freeze the one writer identity that this authenticated sign-out may drain. */
export function beginOperatorSignOutDrain(context: OperatorSignOutDrainContext): OperatorSignOutDrainContext {
  if (!drainContext) drainContext = Object.freeze({ ...context });
  return drainContext;
}

export function getOperatorSignOutDrainContext(): OperatorSignOutDrainContext | undefined { return drainContext; }
export function isOperatorSignOutDraining(): boolean { return Boolean(drainContext); }

/** Auth owns the terminal boundary: only completed local sign-out clears it. */
export function completeOperatorSignOutDrain(): void { drainContext = undefined; }

export function resetOperatorSignOutLifecycleForTests(): void {
  preparation = undefined;
  preparationInFlight = undefined;
  drainContext = undefined;
}
