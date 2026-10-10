export const FIELD_TOUCH_TARGET_MIN_DP = 48;

/**
 * Coalesces repeated physical presses into one logical in-flight operation.
 * The same promise is returned to ambiguous repeat presses so callers observe
 * the authoritative result without creating a second command intent.
 */
export class SingleFlightActionGate {
  private active?: Promise<unknown>;

  get pending(): boolean {
    return Boolean(this.active);
  }

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active) return this.active as Promise<T>;
    const active = Promise.resolve().then(operation);
    this.active = active;
    void active.finally(() => {
      if (this.active === active) this.active = undefined;
    }).catch(() => undefined);
    return active;
  }
}

const operatorMessages: Readonly<Record<string, string>> = Object.freeze({
  CHECKPOINT_REVISION_CONFLICT: "Seadme andmed ei ole serveriga kooskõlas. Taasta pilve kontrollpunktist.",
  CHECKPOINT_REVISION_DIVERGENCE: "Seadme kontrollpunkt on aegunud. Oota ühenduse taastumist või taasta serveri seis.",
  CANONICAL_CHECKPOINT_CONFLICT: "Serveri kontrollpunkti taastamine ebaõnnestus. Kirjutamisõigust ei aktiveeritud.",
  LEASE_CONFLICT: "Simulatsiooni juhib teine seade. Jätkamiseks võta Runtime üle.",
  ACTIVE_ON_ANOTHER_DEVICE: "Simulatsiooni juhib teine seade. Jätkamiseks võta Runtime üle.",
  COMPLETION_FENCED: "Õppuse lõpetamist ei saanud praegu lõpule viia.",
});

export function operatorSafeIssueMessage(code?: string): string {
  if (!code) return "Juhtimisõiguse seis vajab kontrollimist.";
  return operatorMessages[code] ?? "Juhtimisõiguse seis vajab kontrollimist. Proovi pärast ühenduse taastumist uuesti.";
}

export function cloudSyncSafeIssueMessage(message?: string): string {
  if (message === "ASSIGNED_EXERCISE_PACKAGE_UNAVAILABLE" || message === "EXERCISE_PACKAGE_UNAVAILABLE") {
    return "Määratud õppuse pakett pole selles rakenduse versioonis saadaval. Uuenda rakendust.";
  }
  if (message === "ASSIGNED_EXERCISE_UNAVAILABLE") {
    return "Määratud õppust ei leitud. Värskenda õppuste loendit või võta ühendust administraatoriga.";
  }
  if (message?.startsWith("MULTIPLE_ACTIVE_EXERCISES:")) {
    return "Mitme aktiivse õppuse konflikt vajab lahendamist.";
  }
  if (message?.includes("COMPLETION_FENCED")) {
    return operatorMessages.COMPLETION_FENCED;
  }
  return "Sünkroniseerimine jätkub ühenduse taastumisel.";
}
