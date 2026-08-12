import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { MedicationAdministration, MedicationDefinition, MedicationInstance, MedicationRejectionReason, MedicationRuntimeEvent } from "@/models/MedicationRuntime";

export type MedicationOperationResult = { instance?: MedicationInstance; effects: ClinicalEffect[]; events: MedicationRuntimeEvent[] };
export class MedicationEngine {
  private readonly definitions = new Map<string, MedicationDefinition>();
  private readonly instances = new Map<string, MedicationInstance>();
  private readonly seen = new Set<string>();
  private readonly events: MedicationRuntimeEvent[] = [];
  private readonly effects = new Map<string, ClinicalEffect[]>();
  installDefinitions(values: MedicationDefinition[]): void {
    this.definitions.clear();
    for (const d of [...values].sort((a,b) => a.medicationId.localeCompare(b.medicationId))) {
      if (!d.medicationId || !d.name || !d.routes.length || !Number.isFinite(d.durationSec) || d.durationSec < 0 || this.definitions.has(d.medicationId)) throw new Error(`MedicationDefinition ${d.medicationId || "UNKNOWN"} on vigane.`);
      this.definitions.set(d.medicationId, structuredClone(d));
    }
  }
  reset(): void { this.instances.clear(); this.seen.clear(); this.events.length = 0; this.effects.clear(); }
  administer(a: MedicationAdministration, circulation: CirculationState): MedicationOperationResult {
    const definition = this.definitions.get(a.medicationId);
    let rejection: MedicationRejectionReason | undefined;
    if (this.seen.has(a.administrationId)) rejection = "DUPLICATE_ADMINISTRATION";
    else if (!definition) rejection = "DEFINITION_NOT_FOUND";
    else if (!definition.routes.includes(a.route)) rejection = "INVALID_ROUTE";
    else if (!a.administrationId || !a.patientId || !a.administrator || !a.unit || !Number.isFinite(a.dose) || a.dose <= 0 || !Number.isFinite(a.timestamp) || a.timestamp < 0) rejection = "INVALID_ADMINISTRATION";
    else if ((a.route === "IV" || a.route === "IO") && !this.validAccess(a, circulation)) rejection = "MISSING_VASCULAR_ACCESS";
    this.seen.add(a.administrationId);
    if (rejection || !definition) return this.reject(a, rejection ?? "DEFINITION_NOT_FOUND");
    const instance: MedicationInstance = { ...structuredClone(a), medicationName: definition.name, category: definition.category, status: "ACTIVE" };
    this.instances.set(a.administrationId, instance);
    const events = [this.event("MedicationOrdered", a), this.event("MedicationStarted", a)]; this.events.push(...events);
    const effects = definition.supportedEffects.map((item, index): ClinicalEffect => ({ effectId: `${a.administrationId}:${index}`,
      effectType: item.effectType, encounterId: a.patientId, patientId: a.patientId, timestamp: a.timestamp,
      sourceInterventionInstanceId: a.administrationId, parameters: { dose: a.dose, unit: a.unit, ...(item.parameters ?? {}) }, duration: definition.durationSec }));
    this.effects.set(a.administrationId, effects);
    return { instance: structuredClone(instance), effects, events: structuredClone(events) };
  }
  advanceTo(timestamp: number): MedicationRuntimeEvent[] {
    const generated: MedicationRuntimeEvent[] = [];
    for (const item of this.active()) { const d = this.definitions.get(item.medicationId)!;
      if (timestamp >= item.timestamp + d.durationSec) { const next = { ...item, status: "COMPLETED" as const, completedAt: item.timestamp + d.durationSec };
        this.instances.set(item.administrationId, next); generated.push(this.event("MedicationCompleted", next, next.completedAt)); } }
    this.events.push(...generated); return structuredClone(generated);
  }
  cancel(administrationId: string, timestamp: number): MedicationRuntimeEvent {
    const item = this.instances.get(administrationId); if (!item || item.status !== "ACTIVE") throw new Error(`Medication ${administrationId} pole ACTIVE.`);
    const next = { ...item, status: "CANCELLED" as const, cancelledAt: timestamp }; this.instances.set(administrationId, next);
    const event = this.event("MedicationCancelled", next, timestamp); this.events.push(event); return structuredClone(event);
  }
  active(): MedicationInstance[] { return this.snapshot().instances.filter(x => x.status === "ACTIVE"); }
  activeEffects(): ClinicalEffect[] { return this.active().flatMap(x => this.effects.get(x.administrationId) ?? []).sort((a,b)=>a.effectId.localeCompare(b.effectId)).map(x=>structuredClone(x)); }
  snapshot(): { definitions: MedicationDefinition[]; instances: MedicationInstance[]; events: MedicationRuntimeEvent[]; effects: ClinicalEffect[] } {
    return { definitions: [...this.definitions.values()].sort((a,b) => a.medicationId.localeCompare(b.medicationId)).map(x=>structuredClone(x)),
      instances: [...this.instances.values()].sort((a,b)=>a.timestamp-b.timestamp || a.administrationId.localeCompare(b.administrationId)).map(x=>structuredClone(x)), events: structuredClone(this.events),
      effects: [...this.effects.values()].flat().sort((a,b)=>a.effectId.localeCompare(b.effectId)).map(x=>structuredClone(x)) };
  }
  restore(snapshot: Readonly<{ definitions: readonly MedicationDefinition[]; instances: readonly MedicationInstance[]; events: readonly MedicationRuntimeEvent[]; effects: readonly ClinicalEffect[] }>): void {
    this.definitions.clear(); snapshot.definitions.forEach(item => this.definitions.set(item.medicationId, structuredClone(item)));
    this.instances.clear(); snapshot.instances.forEach(item => this.instances.set(item.administrationId, structuredClone(item)));
    this.seen.clear(); snapshot.instances.forEach(item => this.seen.add(item.administrationId));
    this.events.splice(0, this.events.length, ...structuredClone(snapshot.events));
    this.effects.clear();
    for (const effect of snapshot.effects) {
      const id = effect.sourceInterventionInstanceId;
      this.effects.set(id, [...(this.effects.get(id) ?? []), structuredClone(effect)]);
    }
  }
  private validAccess(a: MedicationAdministration, c: CirculationState): boolean { if (!a.vascularAccessId) return false;
    return c.vascularAccess.some(x => x.interventionInstanceId === a.vascularAccessId && (a.route === "IO" ? x.type === "IO" : x.type !== "IO")); }
  private reject(a: MedicationAdministration, reasonCode: MedicationRejectionReason): MedicationOperationResult { const event = this.event("MedicationRejected", a, a.timestamp, reasonCode); this.events.push(event); return { effects: [], events: [event] }; }
  private event(eventType: MedicationRuntimeEvent["eventType"], a: MedicationAdministration, timestamp=a.timestamp, reasonCode?: MedicationRejectionReason): MedicationRuntimeEvent {
    return { eventType, timestamp, administrationId: a.administrationId, medicationId: a.medicationId, patientId: a.patientId, ...(reasonCode ? { reasonCode } : {}) }; }
}
