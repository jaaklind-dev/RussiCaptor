import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { MedicationAdministration, MedicationDefinition, MedicationInstance, MedicationRejectionReason, MedicationRuntimeEvent, MedicationRuntimeSnapshot } from "@/models/MedicationRuntime";
import type { NorepinephrineCommand, NorepinephrineCommandResult, NorepinephrineFeatureProjection, NorepinephrineRuntimeEvent } from "@/models/NorepinephrineInfusion";
import {
  GELOFUSIN_FEATURE_ID,
  SODIUM_CHLORIDE_0_9_FEATURE_ID,
  type AdditionalFluidTherapyRuntimeSnapshot,
  type FluidTherapyRuntimeSnapshot,
  type SupportedFluidTherapyCommand,
  type SupportedFluidTherapyCommandResult,
  type SupportedFluidTherapyEvent,
  type SupportedFluidTherapyProjection,
} from "@/models/FluidTherapy";
import type { VitalSignContributor } from "@/models/VitalSign";
import type {
  TranexamicAcidCommand,
  TranexamicAcidCommandResult,
  TranexamicAcidFeatureProjection,
  TranexamicAcidRuntimeEvent,
} from "@/models/TranexamicAcid";
import type {
  AnalgesicCommand,
  AnalgesicCommandResult,
  AnalgesicAggregateProjection,
  AnalgesicFeatureProjection,
  AnalgesicRuntimeEvent,
} from "@/models/AnalgesiaMedication";
import type {
  AlsMedicationCommand, AlsMedicationCommandResult, AlsMedicationFeatureProjection,
  AlsMedicationRuntimeEvent, AlsRhythmContext,
} from "@/models/AlsMedication";
import { NorepinephrineInfusionRuntime } from "./NorepinephrineInfusion";
import { GelofusinFluidTherapyRuntime } from "./GelofusinFluidTherapy";
import { RINGER_FLUID_CONFIGURATION, RingerFluidTherapyRuntime } from "./RingerFluidTherapy";
import { SodiumChlorideFluidTherapyRuntime } from "./SodiumChlorideFluidTherapy";
import { TranexamicAcidRuntime } from "./TranexamicAcid";
import { AnalgesiaRuntime } from "./AnalgesiaRuntime";
import { AlsMedicationRuntime } from "./AlsMedicationRuntime";

export type MedicationOperationResult = { instance?: MedicationInstance; effects: ClinicalEffect[]; events: MedicationRuntimeEvent[] };
export class MedicationEngine {
  private readonly definitions = new Map<string, MedicationDefinition>();
  private readonly instances = new Map<string, MedicationInstance>();
  private readonly seen = new Set<string>();
  private readonly events: MedicationRuntimeEvent[] = [];
  private readonly effects = new Map<string, ClinicalEffect[]>();
  private readonly norepinephrine = new NorepinephrineInfusionRuntime();
  private readonly ringer = new RingerFluidTherapyRuntime();
  private readonly sodiumChloride = new SodiumChlorideFluidTherapyRuntime();
  private readonly gelofusin = new GelofusinFluidTherapyRuntime();
  private readonly tranexamicAcid = new TranexamicAcidRuntime();
  private readonly analgesia = new AnalgesiaRuntime();
  private readonly alsMedications = new AlsMedicationRuntime();
  installDefinitions(values: MedicationDefinition[]): void {
    this.definitions.clear();
    for (const d of [...values].sort((a,b) => a.medicationId.localeCompare(b.medicationId))) {
      if (!d.medicationId || !d.name || !d.routes.length || !Number.isFinite(d.durationSec) || d.durationSec < 0 || this.definitions.has(d.medicationId)) throw new Error(`MedicationDefinition ${d.medicationId || "UNKNOWN"} on vigane.`);
      this.definitions.set(d.medicationId, structuredClone(d));
    }
  }
  reset(): void { this.instances.clear(); this.seen.clear(); this.events.length = 0; this.effects.clear();
    this.norepinephrine.reset(); this.ringer.reset(); this.sodiumChloride.reset(); this.gelofusin.reset();
    this.tranexamicAcid.reset(); this.analgesia.reset(); this.alsMedications.reset(); }
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
  advanceTo(timestamp: number): (MedicationRuntimeEvent | NorepinephrineRuntimeEvent | SupportedFluidTherapyEvent |
    TranexamicAcidRuntimeEvent | AnalgesicRuntimeEvent | AlsMedicationRuntimeEvent)[] {
    const generated: MedicationRuntimeEvent[] = [];
    for (const item of this.active()) { const d = this.definitions.get(item.medicationId)!;
      if (timestamp >= item.timestamp + d.durationSec) { const next = { ...item, status: "COMPLETED" as const, completedAt: item.timestamp + d.durationSec };
        this.instances.set(item.administrationId, next); generated.push(this.event("MedicationCompleted", next, next.completedAt)); } }
    this.events.push(...generated); return structuredClone([
      ...generated, ...this.norepinephrine.advanceTo(timestamp), ...this.ringer.advanceTo(timestamp),
      ...this.sodiumChloride.advanceTo(timestamp), ...this.gelofusin.advanceTo(timestamp),
      ...this.tranexamicAcid.advanceTo(timestamp),
      ...this.analgesia.advanceTo(timestamp),
    ]);
  }
  cancel(administrationId: string, timestamp: number): MedicationRuntimeEvent {
    const item = this.instances.get(administrationId); if (!item || item.status !== "ACTIVE") throw new Error(`Medication ${administrationId} pole ACTIVE.`);
    const next = { ...item, status: "CANCELLED" as const, cancelledAt: timestamp }; this.instances.set(administrationId, next);
    const event = this.event("MedicationCancelled", next, timestamp); this.events.push(event); return structuredClone(event);
  }
  active(): MedicationInstance[] { return this.snapshot().instances.filter(x => x.status === "ACTIVE"); }
  executeNorepinephrine(command: NorepinephrineCommand, circulation?: CirculationState): NorepinephrineCommandResult {
    return this.norepinephrine.execute(command, circulation);
  }
  norepinephrineProjectionsAt(timestamp: number): readonly NorepinephrineFeatureProjection[] {
    return this.norepinephrine.projectionsAt(timestamp);
  }
  executeFluidTherapy(command: SupportedFluidTherapyCommand,
    circulation?: CirculationState): SupportedFluidTherapyCommandResult {
    if (command.fluidType === SODIUM_CHLORIDE_0_9_FEATURE_ID) {
      return this.sodiumChloride.execute(command, circulation);
    }
    if (command.fluidType === GELOFUSIN_FEATURE_ID) return this.gelofusin.execute(command, circulation);
    return this.ringer.execute(command, circulation);
  }
  fluidTherapyProjectionsAt(timestamp: number): readonly SupportedFluidTherapyProjection[] {
    return [...this.ringer.projectionsAt(timestamp), ...this.sodiumChloride.projectionsAt(timestamp),
      ...this.gelofusin.projectionsAt(timestamp)]
      .sort((a, b) => a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec ||
        a.administrationId.localeCompare(b.administrationId));
  }
  fluidTherapyEventForCommand(commandId: string): SupportedFluidTherapyEvent | undefined {
    return [...(this.ringer.snapshot()?.events ?? []), ...(this.sodiumChloride.snapshot()?.events ?? []),
      ...(this.gelofusin.snapshot()?.events ?? [])]
      .filter(event => event.commandId === commandId).at(-1);
  }
  executeTranexamicAcid(command: TranexamicAcidCommand, circulation?: CirculationState,
    authoritativeInjuryOnsetSimulationTimeSec?: number): TranexamicAcidCommandResult {
    return this.tranexamicAcid.execute(command, circulation, authoritativeInjuryOnsetSimulationTimeSec);
  }
  tranexamicAcidProjectionsAt(timestamp: number): readonly TranexamicAcidFeatureProjection[] {
    return this.tranexamicAcid.projectionsAt(timestamp);
  }
  tranexamicAcidEventForCommand(commandId: string): TranexamicAcidRuntimeEvent | undefined {
    return this.tranexamicAcid.eventForCommand(commandId);
  }
  executeAnalgesic(command: AnalgesicCommand, circulation?: CirculationState): AnalgesicCommandResult {
    return this.analgesia.execute(command, circulation);
  }
  analgesicProjectionsAt(timestamp: number): readonly AnalgesicFeatureProjection[] {
    return this.analgesia.projectionsAt(timestamp);
  }
  analgesicEventForCommand(commandId: string): AnalgesicRuntimeEvent | undefined {
    return this.analgesia.eventForCommand(commandId);
  }
  analgesicAggregateAt(patientId: string, timestamp: number): AnalgesicAggregateProjection {
    return this.analgesia.aggregateAt(patientId, timestamp);
  }
  executeAlsMedication(command: AlsMedicationCommand, circulation: CirculationState | undefined,
    context: AlsRhythmContext | undefined): AlsMedicationCommandResult {
    return this.alsMedications.execute(command, circulation, context);
  }
  alsMedicationProjectionsAt(timestamp: number, patientId?: string): readonly AlsMedicationFeatureProjection[] {
    return this.alsMedications.projectionsAt(timestamp, patientId);
  }
  alsMedicationEventForCommand(commandId: string): AlsMedicationRuntimeEvent | undefined {
    return this.alsMedications.eventForCommand(commandId);
  }
  vitalContributorsAt(timestamp: number): readonly VitalSignContributor[] {
    return [...this.ringer.vitalContributorsAt(timestamp), ...this.sodiumChloride.vitalContributorsAt(timestamp),
      ...this.gelofusin.vitalContributorsAt(timestamp),
      ...this.norepinephrine.vitalContributorsAt(timestamp), ...this.analgesia.vitalContributorsAt(timestamp),
      ...this.alsMedications.vitalContributorsAt(timestamp)];
  }
  activeEffects(timestamp = 0): ClinicalEffect[] {
    const medicationEffects = this.active().flatMap(x => this.effects.get(x.administrationId) ?? []);
    const norepinephrineEffects = this.norepinephrine.projectionsAt(timestamp)
      .filter(item => item.status !== "STOPPED" && (item.currentSystolicIncreaseMmHg > 0 || item.currentDiastolicIncreaseMmHg > 0))
      .map((item): ClinicalEffect => ({ effectId: `${item.infusionId}:VASOPRESSOR`, effectType: "VASOPRESSOR_SUPPORT",
        encounterId: item.patientId, patientId: item.patientId, timestamp,
        sourceInterventionInstanceId: item.infusionId, parameters: {
          doseMicrogramsPerKgMin: item.doseMicrogramsPerKgMin, unit: item.unit,
          systolicIncreaseMmHg: item.currentSystolicIncreaseMmHg,
          diastolicIncreaseMmHg: item.currentDiastolicIncreaseMmHg,
        } }));
    const antifibrinolyticEffects = this.tranexamicAcid.projectionsAt(timestamp)
      .filter(item => item.currentAntifibrinolyticEffect > 0)
      .map((item): ClinicalEffect => ({ effectId: `${item.regimenId}:ANTIFIBRINOLYTIC`,
        effectType: "ANTIFIBRINOLYTIC_SUPPORT", encounterId: item.patientId, patientId: item.patientId,
        timestamp, sourceInterventionInstanceId: item.regimenId, parameters: {
          drugId: item.featureId, txaEffect: item.currentAntifibrinolyticEffect,
          timingClassification: item.timingClassification,
        } }));
    return [...medicationEffects, ...norepinephrineEffects, ...antifibrinolyticEffects]
      .sort((a,b)=>a.effectId.localeCompare(b.effectId)).map(x=>structuredClone(x));
  }
  snapshot(): MedicationRuntimeSnapshot {
    const norepinephrine = this.norepinephrine.snapshot();
    const ringer = this.ringer.snapshot();
    const sodiumChloride = this.sodiumChloride.snapshot();
    const gelofusin = this.gelofusin.snapshot();
    const tranexamicAcid = this.tranexamicAcid.snapshot();
    const analgesia = this.analgesia.snapshot();
    const alsMedications = this.alsMedications.snapshot();
    const additionalProducts: AdditionalFluidTherapyRuntimeSnapshot[] = [
      ...(sodiumChloride ? [sodiumChloride] : []),
      ...(gelofusin ? [gelofusin] : []),
    ];
    const fluidTherapy = ringer || additionalProducts.length ? {
      ...(ringer ?? { schemaVersion: 1 as const, configuration: structuredClone(RINGER_FLUID_CONFIGURATION),
        administrations: [], commandResults: [], events: [] }),
      ...(additionalProducts.length ? { additionalProducts } : {}),
    } : undefined;
    return { definitions: [...this.definitions.values()].sort((a,b) => a.medicationId.localeCompare(b.medicationId)).map(x=>structuredClone(x)),
      instances: [...this.instances.values()].sort((a,b)=>a.timestamp-b.timestamp || a.administrationId.localeCompare(b.administrationId)).map(x=>structuredClone(x)), events: structuredClone(this.events),
      effects: [...this.effects.values()].flat().sort((a,b)=>a.effectId.localeCompare(b.effectId)).map(x=>structuredClone(x)),
      ...(norepinephrine ? { norepinephrine } : {}),
      ...(fluidTherapy ? { fluidTherapy } : {}),
      ...(tranexamicAcid ? { tranexamicAcid } : {}),
      ...(analgesia ? { analgesia } : {}),
      ...(alsMedications ? { alsMedications } : {}) };
  }
  restore(snapshot: MedicationRuntimeSnapshot): void {
    this.definitions.clear(); snapshot.definitions.forEach(item => this.definitions.set(item.medicationId, structuredClone(item)));
    this.instances.clear(); snapshot.instances.forEach(item => this.instances.set(item.administrationId, structuredClone(item)));
    this.seen.clear(); snapshot.instances.forEach(item => this.seen.add(item.administrationId));
    this.events.splice(0, this.events.length, ...structuredClone(snapshot.events));
    this.effects.clear();
    for (const effect of snapshot.effects) {
      const id = effect.sourceInterventionInstanceId;
      this.effects.set(id, [...(this.effects.get(id) ?? []), structuredClone(effect)]);
    }
    this.norepinephrine.restore(snapshot.norepinephrine);
    this.tranexamicAcid.restore(snapshot.tranexamicAcid);
    this.analgesia.restore(snapshot.analgesia);
    this.alsMedications.restore(snapshot.alsMedications);
    if (snapshot.fluidTherapy) {
      const { additionalProducts, ...ringer } = snapshot.fluidTherapy;
      this.ringer.restore(ringer);
      const sodiumChloride = additionalProducts?.find((item): item is FluidTherapyRuntimeSnapshot<
        typeof SODIUM_CHLORIDE_0_9_FEATURE_ID
      > => item.configuration.fluidType === SODIUM_CHLORIDE_0_9_FEATURE_ID);
      const gelofusin = additionalProducts?.find((item): item is FluidTherapyRuntimeSnapshot<
        typeof GELOFUSIN_FEATURE_ID
      > => item.configuration.fluidType === GELOFUSIN_FEATURE_ID);
      this.sodiumChloride.restore(sodiumChloride);
      this.gelofusin.restore(gelofusin);
    } else {
      this.ringer.restore();
      this.sodiumChloride.restore();
      this.gelofusin.restore();
    }
  }
  private validAccess(a: MedicationAdministration, c: CirculationState): boolean { if (!a.vascularAccessId) return false;
    return c.vascularAccess.some(x => x.interventionInstanceId === a.vascularAccessId && (a.route === "IO" ? x.type === "IO" : x.type !== "IO")); }
  private reject(a: MedicationAdministration, reasonCode: MedicationRejectionReason): MedicationOperationResult { const event = this.event("MedicationRejected", a, a.timestamp, reasonCode); this.events.push(event); return { effects: [], events: [event] }; }
  private event(eventType: MedicationRuntimeEvent["eventType"], a: MedicationAdministration, timestamp=a.timestamp, reasonCode?: MedicationRejectionReason): MedicationRuntimeEvent {
    return { eventType, timestamp, administrationId: a.administrationId, medicationId: a.medicationId, patientId: a.patientId, ...(reasonCode ? { reasonCode } : {}) }; }
}
