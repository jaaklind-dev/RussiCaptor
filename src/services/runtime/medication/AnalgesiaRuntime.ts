import type { ActiveVascularAccess, CirculationState } from "@/models/CirculationState";
import {
  ANALGESIA_FEATURE_ID,
  type AnalgesicAdministrationState,
  type AnalgesicAggregateProjection,
  type AnalgesicCommand,
  type AnalgesicCommandResult,
  type AnalgesicEffectDimensions,
  type AnalgesicFeatureProjection,
  type AnalgesicPainState,
  type AnalgesicProductConfiguration,
  type AnalgesicRejectionReason,
  type AnalgesicRuntimeEvent,
  type AnalgesiaRuntimeSnapshot,
} from "@/models/AnalgesiaMedication";
import type { VitalSignContributor, VitalSignKey } from "@/models/VitalSign";
import { ANALGESIC_PRODUCT_CONFIGURATIONS, analgesicProductById, canonicalAnalgesicDrugId } from "./AnalgesicProducts";

const precise = (value: number): number => Number(value.toFixed(6));
const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const smoothStep = (value: number): number => { const x = clamp(value); return x * x * (3 - 2 * x); };
const EMPTY_EFFECTS: AnalgesicEffectDimensions = Object.freeze({ analgesia: 0, sedation: 0,
  respiratoryDepression: 0, dissociation: 0, sympatheticEffect: 0, hemodynamicDepression: 0,
  antiInflammatoryAnalgesia: 0 });
const effectKeys = Object.keys(EMPTY_EFFECTS) as (keyof AnalgesicEffectDimensions)[];

function ratePerSecond(state: Pick<AnalgesicAdministrationState, "rate" | "rateUnit">): number {
  if (!state.rate || !state.rateUnit) return 0;
  return state.rateUnit === "MG_H" ? state.rate / 3600 : state.rate / 60;
}

export function deliveredAnalgesicDoseAt(state: AnalgesicAdministrationState,
  simulationTimeSec: number, configuration: AnalgesicProductConfiguration): number {
  if (state.lifecycle !== "RUNNING") return state.deliveredDose;
  const elapsed = Math.max(0, simulationTimeSec - state.lastRateChangeAtSimulationTimeSec);
  if (state.mode === "BOLUS") {
    const totalElapsed = Math.max(0, simulationTimeSec - state.startedAtSimulationTimeSec);
    return precise((state.prescribedDose ?? 0) * Math.min(1, totalElapsed / configuration.bolusDeliveryDurationSec));
  }
  return precise(state.deliveredDoseAtLastChange + ratePerSecond(state) * elapsed);
}

export function normalizedAnalgesicExposureAt(state: AnalgesicAdministrationState,
  simulationTimeSec: number, configuration: AnalgesicProductConfiguration): number {
  if (state.lifecycle === "STOPPED") {
    const elapsed = Math.max(0, simulationTimeSec - (state.stoppedAtSimulationTimeSec ?? simulationTimeSec));
    return precise(clamp((state.terminalExposureAnchor ?? 0) *
      Math.pow(0.5, elapsed / configuration.effectHalfLifeSec)));
  }
  const elapsed = Math.max(0, simulationTimeSec - state.startedAtSimulationTimeSec);
  if (state.mode === "BOLUS") {
    const deliveredFraction = clamp(deliveredAnalgesicDoseAt(state, simulationTimeSec, configuration) /
      configuration.referenceExposureDose);
    if (elapsed <= configuration.onsetDurationSec) {
      return precise(deliveredFraction * smoothStep(elapsed / configuration.onsetDurationSec));
    }
    const peak = clamp((state.prescribedDose ?? 0) / configuration.referenceExposureDose);
    return precise(peak * Math.pow(0.5,
      (elapsed - configuration.onsetDurationSec) / configuration.effectHalfLifeSec));
  }
  const doseFraction = clamp(deliveredAnalgesicDoseAt(state, simulationTimeSec, configuration) /
    configuration.referenceExposureDose);
  return precise(doseFraction * smoothStep(elapsed / configuration.onsetDurationSec));
}

function scaledEffects(configuration: AnalgesicProductConfiguration, exposure: number): AnalgesicEffectDimensions {
  return Object.freeze(Object.fromEntries(effectKeys.map(key => [key,
    precise(clamp(configuration.effects[key] * exposure))])) as unknown as AnalgesicEffectDimensions);
}

/** Order-independent bounded union: 1 - product(1 - effect). */
export function combineAnalgesicEffects(values: readonly AnalgesicEffectDimensions[]): AnalgesicEffectDimensions {
  return Object.freeze(Object.fromEntries(effectKeys.map(key => [key, precise(1 - values.reduce(
    (remaining, value) => remaining * (1 - clamp(value[key])), 1))])) as unknown as AnalgesicEffectDimensions);
}

function productFor(value: string): AnalgesicProductConfiguration | undefined {
  return analgesicProductById.get(canonicalAnalgesicDrugId(value) as never);
}

function validate(command: AnalgesicCommand, configuration?: AnalgesicProductConfiguration): AnalgesicRejectionReason[] {
  const errors: AnalgesicRejectionReason[] = [];
  if (!command.commandId || !command.administrationId || !command.patientId || !command.drugId ||
    !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0 ||
    !["START", "CHANGE_RATE", "STOP"].includes(command.action)) errors.push("INVALID_COMMAND");
  if (!configuration) return [...new Set([...errors, "UNKNOWN_DRUG" as const])];
  if (command.action === "START") {
    if (!command.mode || !configuration.modes.includes(command.mode)) errors.push("INVALID_MODE");
    if (!command.route || !configuration.routes.includes(command.route)) errors.push("INVALID_ROUTE");
    if (!command.vascularAccessId) errors.push("MISSING_VASCULAR_ACCESS");
  }
  if (command.action === "START" && command.mode === "BOLUS") {
    if (command.doseUnit !== configuration.bolusDoseUnit) errors.push("INVALID_UNIT");
    if (typeof command.dose !== "number" || !Number.isFinite(command.dose) || command.dose <= 0 ||
      command.dose > (configuration.maximumBolusDose ?? 0)) errors.push("INVALID_DOSE");
  }
  if ((command.action === "START" && command.mode === "INFUSION") || command.action === "CHANGE_RATE") {
    if (command.rateUnit !== configuration.infusionRateUnit) errors.push("INVALID_UNIT");
    if (typeof command.rate !== "number" || !Number.isFinite(command.rate) || command.rate <= 0 ||
      command.rate > (configuration.maximumInfusionRate ?? 0)) errors.push("INVALID_RATE");
  }
  return [...new Set(errors)];
}

export function analgesicVitalContributors(aggregate: AnalgesicAggregateProjection): readonly VitalSignContributor[] {
  const values: readonly [VitalSignKey, number][] = [
    ["respiratoryRate", -10 * aggregate.respiratoryDepression],
    ["gcs", -5 * aggregate.sedation],
    ["heartRate", 15 * aggregate.sympatheticEffect - 5 * aggregate.hemodynamicDepression],
    ["systolicBp", 20 * aggregate.sympatheticEffect - 15 * aggregate.hemodynamicDepression],
    ["diastolicBp", 10 * aggregate.sympatheticEffect - 8 * aggregate.hemodynamicDepression],
  ];
  return Object.freeze(values.filter(([, value]) => Math.abs(value) > 0).map(([vital, value]) => Object.freeze({
    contributorId: `${ANALGESIA_FEATURE_ID}:${aggregate.patientId}:${vital}`,
    sourceType: "CLINICAL_EFFECT" as const, sourceId: ANALGESIA_FEATURE_ID,
    layer: "MEDICATION" as const, vital, operation: "DELTA" as const, value: precise(value),
  })));
}

export class AnalgesiaRuntime {
  private readonly administrations = new Map<string, AnalgesicAdministrationState>();
  private readonly painStates = new Map<string, AnalgesicPainState>();
  private readonly commandResults = new Map<string, AnalgesicCommandResult>();
  private readonly events: AnalgesicRuntimeEvent[] = [];

  reset(): void { this.administrations.clear(); this.painStates.clear(); this.commandResults.clear();
    this.events.length = 0; }

  execute(command: AnalgesicCommand, circulation?: CirculationState): AnalgesicCommandResult {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const configuration = productFor(command.drugId);
    const errors = validate(command, configuration);
    if (!errors.length && command.action === "START" && circulation?.patientId !== command.patientId) {
      errors.push("INVALID_PATIENT");
    }
    const access = command.action === "START" ? this.access(command, circulation) : undefined;
    if (!errors.length && command.action === "START" && !access) errors.push("MISSING_VASCULAR_ACCESS");
    if (!errors.length && command.action === "START" && access &&
      (command.route === "IO") !== (access.type === "IO")) errors.push("INVALID_ROUTE");
    if (errors.length || !configuration) return this.reject(command, errors[0] ?? "UNKNOWN_DRUG", configuration);
    const result = command.action === "START" ? this.start(command, configuration)
      : command.action === "CHANGE_RATE" ? this.changeRate(command, configuration) : this.stop(command, configuration);
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  advanceTo(simulationTimeSec: number): AnalgesicRuntimeEvent[] {
    const generated: AnalgesicRuntimeEvent[] = [];
    for (const prior of this.orderedAdministrations()) {
      if (prior.lifecycle !== "RUNNING") continue;
      const configuration = analgesicProductById.get(prior.drugId)!;
      const delivered = deliveredAnalgesicDoseAt(prior, simulationTimeSec, configuration);
      if (prior.mode === "BOLUS" && simulationTimeSec >= prior.startedAtSimulationTimeSec +
        configuration.bolusDeliveryDurationSec) {
        const completedAt = prior.startedAtSimulationTimeSec + configuration.bolusDeliveryDurationSec;
        const next: AnalgesicAdministrationState = Object.freeze({ ...prior, lifecycle: "COMPLETED",
          deliveredDose: prior.prescribedDose!, deliveredDoseAtLastChange: prior.prescribedDose!,
          completedAtSimulationTimeSec: completedAt });
        this.administrations.set(prior.administrationId, next);
        generated.push(this.event("AnalgesicAdministrationCompleted", next, completedAt));
      } else if (prior.mode === "INFUSION") {
        this.administrations.set(prior.administrationId, Object.freeze({ ...prior, deliveredDose: delivered,
          deliveredDoseAtLastChange: delivered, lastRateChangeAtSimulationTimeSec: simulationTimeSec }));
      } else {
        this.administrations.set(prior.administrationId, Object.freeze({ ...prior, deliveredDose: delivered }));
      }
    }
    this.events.push(...generated);
    return structuredClone(generated);
  }

  projectionsAt(simulationTimeSec: number): readonly AnalgesicFeatureProjection[] {
    const aggregateByPatient = new Map(this.patientIds().map(patientId => [patientId,
      this.aggregateAt(patientId, simulationTimeSec)]));
    return this.orderedAdministrations().map(state => {
      const configuration = analgesicProductById.get(state.drugId)!;
      const exposure = normalizedAnalgesicExposureAt(state, simulationTimeSec, configuration);
      const dimensions = scaledEffects(configuration, exposure);
      const aggregate = aggregateByPatient.get(state.patientId)!;
      return Object.freeze({ featureId: ANALGESIA_FEATURE_ID, administrationId: state.administrationId,
        patientId: state.patientId, drugId: state.drugId, displayName: configuration.displayName,
        aliases: structuredClone(configuration.aliases), drugClass: configuration.drugClass,
        route: state.route, mode: state.mode, lifecycle: state.lifecycle,
        ...(state.prescribedDose === undefined ? {} : { prescribedDose: state.prescribedDose }),
        ...(state.doseUnit === undefined ? {} : { doseUnit: state.doseUnit }),
        ...(state.rateUnit === undefined ? {} : { currentRate: state.lifecycle === "RUNNING" ? state.rate : 0,
          rateUnit: state.rateUnit }),
        deliveredDose: deliveredAnalgesicDoseAt(state, simulationTimeSec, configuration),
        startedAtSimulationTimeSec: state.startedAtSimulationTimeSec,
        lastRateChangeAtSimulationTimeSec: state.lastRateChangeAtSimulationTimeSec,
        ...(state.stoppedAtSimulationTimeSec === undefined ? {} : { stoppedAtSimulationTimeSec: state.stoppedAtSimulationTimeSec }),
        ...(state.completedAtSimulationTimeSec === undefined ? {} : { completedAtSimulationTimeSec: state.completedAtSimulationTimeSec }),
        normalizedExposure: exposure, ...dimensions, baselinePainIntensity: aggregate.baselinePainIntensity,
        currentPainIntensity: aggregate.currentPainIntensity });
    });
  }

  aggregateAt(patientId: string, simulationTimeSec: number): AnalgesicAggregateProjection {
    const state = this.painStates.get(patientId);
    const effects = this.orderedAdministrations().filter(item => item.patientId === patientId).map(item => {
      const configuration = analgesicProductById.get(item.drugId)!;
      return scaledEffects(configuration, normalizedAnalgesicExposureAt(item, simulationTimeSec, configuration));
    });
    const combined = combineAnalgesicEffects(effects);
    const baselinePainIntensity = state?.baselinePainIntensity ?? 0;
    return Object.freeze({ patientId, ...combined, baselinePainIntensity,
      currentPainIntensity: precise(Math.max(0, baselinePainIntensity * (1 - combined.analgesia))) });
  }

  vitalContributorsAt(simulationTimeSec: number): readonly VitalSignContributor[] {
    return Object.freeze(this.patientIds().flatMap(patientId => analgesicVitalContributors(
      this.aggregateAt(patientId, simulationTimeSec))));
  }

  eventForCommand(commandId: string): AnalgesicRuntimeEvent | undefined {
    return structuredClone(this.events.filter(event => event.commandId === commandId).at(-1));
  }

  snapshot(): AnalgesiaRuntimeSnapshot | undefined {
    if (!this.administrations.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({ schemaVersion: 1,
      productConfigurations: ANALGESIC_PRODUCT_CONFIGURATIONS.map(item => structuredClone(item)),
      administrations: this.orderedAdministrations().map(item => structuredClone(item)),
      painStates: [...this.painStates.values()].sort((a, b) => a.patientId.localeCompare(b.patientId))
        .map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId))
        .map(item => structuredClone(item)), events: structuredClone(this.events) });
  }

  restore(snapshot?: AnalgesiaRuntimeSnapshot): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || JSON.stringify(snapshot.productConfigurations) !==
      JSON.stringify(ANALGESIC_PRODUCT_CONFIGURATIONS)) throw new Error("ANALGESIA_CONFIGURATION_MISMATCH");
    snapshot.administrations.forEach(item => this.administrations.set(item.administrationId, structuredClone(item)));
    snapshot.painStates.forEach(item => this.painStates.set(item.patientId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private start(command: AnalgesicCommand, configuration: AnalgesicProductConfiguration): AnalgesicCommandResult {
    if (this.administrations.has(command.administrationId)) return this.reject(command, "INVALID_STATE", configuration, false);
    const state: AnalgesicAdministrationState = Object.freeze({ schemaVersion: 1,
      featureId: ANALGESIA_FEATURE_ID, administrationId: command.administrationId, patientId: command.patientId,
      drugId: configuration.drugId, productVersion: configuration.version, route: command.route!,
      vascularAccessId: command.vascularAccessId!, mode: command.mode!, lifecycle: "RUNNING",
      ...(command.mode === "BOLUS" ? { prescribedDose: command.dose!, doseUnit: configuration.bolusDoseUnit! }
        : { rate: command.rate!, rateUnit: configuration.infusionRateUnit! }),
      deliveredDose: 0, deliveredDoseAtLastChange: 0,
      startedAtSimulationTimeSec: command.simulationTimeSec,
      lastRateChangeAtSimulationTimeSec: command.simulationTimeSec });
    this.administrations.set(state.administrationId, state);
    if (!this.painStates.has(state.patientId)) this.painStates.set(state.patientId,
      Object.freeze({ patientId: state.patientId, baselinePainIntensity: 1 }));
    this.events.push(this.event("AnalgesicAdministrationStarted", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private changeRate(command: AnalgesicCommand, configuration: AnalgesicProductConfiguration): AnalgesicCommandResult {
    const prior = this.administrations.get(command.administrationId);
    if (!prior) return this.reject(command, "ADMINISTRATION_NOT_FOUND", configuration, false);
    if (prior.patientId !== command.patientId || prior.drugId !== configuration.drugId || prior.mode !== "INFUSION" ||
      prior.lifecycle !== "RUNNING") return this.reject(command, "INVALID_STATE", configuration, false);
    if (command.simulationTimeSec < prior.lastRateChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", configuration, false);
    }
    if (prior.rate === command.rate) return Object.freeze({ status: "NO_OP", commandId: command.commandId,
      state: structuredClone(prior) });
    const delivered = deliveredAnalgesicDoseAt(prior, command.simulationTimeSec, configuration);
    const state: AnalgesicAdministrationState = Object.freeze({ ...prior, rate: command.rate!,
      deliveredDose: delivered, deliveredDoseAtLastChange: delivered,
      lastRateChangeAtSimulationTimeSec: command.simulationTimeSec });
    this.administrations.set(state.administrationId, state);
    this.events.push(this.event("AnalgesicRateChanged", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private stop(command: AnalgesicCommand, configuration: AnalgesicProductConfiguration): AnalgesicCommandResult {
    const prior = this.administrations.get(command.administrationId);
    if (!prior) return this.reject(command, "ADMINISTRATION_NOT_FOUND", configuration, false);
    if (prior.patientId !== command.patientId || prior.drugId !== configuration.drugId) {
      return this.reject(command, "INVALID_STATE", configuration, false);
    }
    if (prior.lifecycle !== "RUNNING") return Object.freeze({ status: "NO_OP", commandId: command.commandId,
      state: structuredClone(prior) });
    if (command.simulationTimeSec < prior.lastRateChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", configuration, false);
    }
    const delivered = deliveredAnalgesicDoseAt(prior, command.simulationTimeSec, configuration);
    const exposure = normalizedAnalgesicExposureAt(prior, command.simulationTimeSec, configuration);
    const state: AnalgesicAdministrationState = Object.freeze({ ...prior, lifecycle: "STOPPED", rate: 0,
      deliveredDose: delivered, deliveredDoseAtLastChange: delivered,
      stoppedAtSimulationTimeSec: command.simulationTimeSec, terminalExposureAnchor: exposure });
    this.administrations.set(state.administrationId, state);
    this.events.push(this.event("AnalgesicAdministrationStopped", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private reject(command: AnalgesicCommand, reasonCode: AnalgesicRejectionReason,
    configuration?: AnalgesicProductConfiguration, remember = true): AnalgesicCommandResult {
    const result: AnalgesicCommandResult = Object.freeze({ status: "REJECTED", commandId: command.commandId,
      rejectionReason: reasonCode });
    if (remember && command.commandId) this.commandResults.set(command.commandId, result);
    this.events.push(Object.freeze({ eventType: "AnalgesicCommandRejected", commandId: command.commandId,
      administrationId: command.administrationId, patientId: command.patientId,
      drugId: configuration?.drugId ?? "UNKNOWN", timestamp: command.simulationTimeSec,
      lifecycle: "STOPPED", deliveredDose: 0, reasonCode }));
    return structuredClone(result);
  }

  private event(eventType: AnalgesicRuntimeEvent["eventType"], state: AnalgesicAdministrationState,
    timestamp: number, commandId?: string): AnalgesicRuntimeEvent {
    return Object.freeze({ eventType, commandId, administrationId: state.administrationId,
      patientId: state.patientId, drugId: state.drugId, timestamp, lifecycle: state.lifecycle,
      deliveredDose: state.deliveredDose });
  }

  private access(command: AnalgesicCommand, circulation?: CirculationState): ActiveVascularAccess | undefined {
    return circulation?.vascularAccess.find(item => item.interventionInstanceId === command.vascularAccessId);
  }

  private orderedAdministrations(): AnalgesicAdministrationState[] {
    return [...this.administrations.values()].sort((a, b) =>
      a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec || a.administrationId.localeCompare(b.administrationId));
  }

  private patientIds(): string[] { return [...this.painStates.keys()].sort(); }
}

export { EMPTY_EFFECTS };
