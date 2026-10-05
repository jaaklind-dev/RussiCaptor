type SignOutPreparation = () => Promise<void>;

let preparation: SignOutPreparation | undefined;
let preparationInFlight: Promise<void> | undefined;

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
  if (!current) return Promise.resolve();
  const task = Promise.resolve().then(current);
  const inFlight = task.finally(() => {
    if (preparationInFlight === inFlight) preparationInFlight = undefined;
  });
  preparationInFlight = inFlight;
  return inFlight;
}

export function resetOperatorSignOutLifecycleForTests(): void {
  preparation = undefined;
  preparationInFlight = undefined;
}
