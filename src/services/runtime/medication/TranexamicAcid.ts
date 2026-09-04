import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalFeatureContract } from "@/models/ClinicalFeatureContract";
import {
  TRANEXAMIC_ACID_DOSE_UNIT,
  TRANEXAMIC_ACID_FEATURE_ID,
  TRANEXAMIC_ACID_REGIMEN_VERSION,
  type TranexamicAcidCommand,
  type TranexamicAcidCommandResult,
  type TranexamicAcidConfiguration,
  type TranexamicAcidFeatureProjection,
  type TranexamicAcidRegimenState,
  type TranexamicAcidRejectionReason,
  type TranexamicAcidRuntimeEvent,
  type TranexamicAcidRuntimeSnapshot,
  type TranexamicAcidTimingClassification,
} from "@/models/TranexamicAcid";

export const DEFAULT_TRANEXAMIC_ACID_CONFIGURATION: TranexamicAcidConfiguration = Object.freeze({
  schemaVersion: 1,
  regimenVersion: TRANEXAMIC_ACID_REGIMEN_VERSION,
  loadingDoseMg: 1000,
  loadingDurationSec: 600,
  maintenanceDoseMg: 1000,
  maintenanceDurationSec: 28_800,
  eligibleTraumaWindowSec: 10_800,
  effectHalfLifeSec: 7200,
});

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smoothStep = (value: number): number => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};

export function classifyTranexamicAcidTiming(
  startedAtSimulationTimeSec: number,
  authoritativeInjuryOnsetSimulationTimeSec: number | undefined,
  configuration: TranexamicAcidConfiguration = DEFAULT_TRANEXAMIC_ACID_CONFIGURATION,
): TranexamicAcidTimingClassification {
  if (authoritativeInjuryOnsetSimulationTimeSec === undefined) {
    return "TRAUMA_WINDOW_CLASSIFICATION_DEFERRED_NO_AUTHORITATIVE_INJURY_TIME";
  }
  return startedAtSimulationTimeSec - authoritativeInjuryOnsetSimulationTimeSec <= configuration.eligibleTraumaWindowSec
    ? "WITHIN_WINDOW" : "LATE";
}

function activeStateAt(
  state: TranexamicAcidRegimenState,
  simulationTimeSec: number,
  configuration: TranexamicAcidConfiguration,
): TranexamicAcidRegimenState {
  if (state.lifecycle === "STOPPED" || state.lifecycle === "COMPLETED") return state;
  const elapsed = Math.max(0, simulationTimeSec - state.startedAtSimulationTimeSec);
  const loadingFraction = clamp(elapsed / configuration.loadingDurationSec, 0, 1);
  const maintenanceFraction = clamp(
    (elapsed - configuration.loadingDurationSec) / configuration.maintenanceDurationSec, 0, 1,
  );
  const loadingDeliveredMg = round(configuration.loadingDoseMg * loadingFraction);
  const maintenanceDeliveredMg = round(configuration.maintenanceDoseMg * maintenanceFraction);
  const completedAt = state.startedAtSimulationTimeSec + configuration.loadingDurationSec +
    configuration.maintenanceDurationSec;
  if (maintenanceFraction >= 1) {
    return Object.freeze({ ...state, lifecycle: "COMPLETED", loadingStatus: "COMPLETED",
      maintenanceStatus: "COMPLETED", loadingDeliveredMg, maintenanceDeliveredMg,
      completedAtSimulationTimeSec: completedAt, terminalEffectAnchor: state.timingClassification === "LATE" ? 0 : 1 });
  }
  if (loadingFraction >= 1) {
    return Object.freeze({ ...state, lifecycle: "MAINTENANCE", loadingStatus: "COMPLETED",
      maintenanceStatus: "RUNNING", loadingDeliveredMg, maintenanceDeliveredMg });
  }
  return Object.freeze({ ...state, lifecycle: "LOADING", loadingStatus: "RUNNING",
    maintenanceStatus: "NOT_STARTED", loadingDeliveredMg, maintenanceDeliveredMg });
}

export function tranexamicAcidEffectAt(
  state: TranexamicAcidRegimenState,
  simulationTimeSec: number,
  configuration: TranexamicAcidConfiguration = DEFAULT_TRANEXAMIC_ACID_CONFIGURATION,
): number {
  if (state.timingClassification === "LATE") return 0;
  if (state.lifecycle === "STOPPED" || state.lifecycle === "COMPLETED") {
    const terminalAt = state.stoppedAtSimulationTimeSec ?? state.completedAtSimulationTimeSec ?? simulationTimeSec;
    const anchor = clamp(state.terminalEffectAnchor ?? 0, 0, 1);
    return round(anchor * Math.pow(0.5, Math.max(0, simulationTimeSec - terminalAt) / configuration.effectHalfLifeSec));
  }
  const current = activeStateAt(state, simulationTimeSec, configuration);
  if (current.lifecycle === "COMPLETED") {
    return tranexamicAcidEffectAt(current, simulationTimeSec, configuration);
  }
  if (current.lifecycle === "MAINTENANCE") return 1;
  return round(smoothStep(current.loadingDeliveredMg / configuration.loadingDoseMg));
}

function commandErrors(command: TranexamicAcidCommand): TranexamicAcidRejectionReason[] {
  const errors: TranexamicAcidRejectionReason[] = [];
  if (!command.commandId || !command.regimenId || !command.patientId ||
    !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0 ||
    !["START", "STOP"].includes(command.action)) errors.push("INVALID_COMMAND");
  if (command.action === "START" && !command.vascularAccessId) errors.push("MISSING_VASCULAR_ACCESS");
  return [...new Set(errors)];
}

export const tranexamicAcidClinicalFeatureContract: ClinicalFeatureContract<
  typeof TRANEXAMIC_ACID_FEATURE_ID,
  TranexamicAcidCommand,
  TranexamicAcidRegimenState,
  TranexamicAcidConfiguration
> = Object.freeze({
  featureId: TRANEXAMIC_ACID_FEATURE_ID,
  category: "ANTIFIBRINOLYTIC",
  schemaVersion: 1,
  configuration: DEFAULT_TRANEXAMIC_ACID_CONFIGURATION,
  input: Object.freeze({
    unit: TRANEXAMIC_ACID_DOSE_UNIT,
    actions: Object.freeze(["START", "STOP"]),
    validate: (command: TranexamicAcidCommand) => Object.freeze(commandErrors(command)),
  }),
  authoritativeState: Object.freeze({
    lifecycle: Object.freeze(["RUNNING", "STOPPED", "COMPLETED"] as const),
    persistedFields: Object.freeze([
      "regimenId", "patientId", "route", "vascularAccessId", "lifecycle", "regimenVersion",
      "loadingStatus", "maintenanceStatus", "loadingDeliveredMg", "maintenanceDeliveredMg",
      "startedAtSimulationTimeSec", "phaseTransitionAtSimulationTimeSec", "timingClassification",
      "authoritativeInjuryOnsetSimulationTimeSec", "stoppedAtSimulationTimeSec",
      "completedAtSimulationTimeSec", "terminalEffectAnchor",
    ]),
  }),
  determinism: Object.freeze({ clock: "SIMULATION_TIME", wallClockAllowed: false }),
  physiology: Object.freeze({
    order: Object.freeze([
      "BASE_BLEEDING_SOURCE", "SOURCE_CONTROL", "PRESSURE_EFFECT", "TEMPERATURE_COAGULATION",
      "FIBRINOLYSIS_CLOT_STABILITY", "FINAL_BLEEDING_RATE",
    ] as const),
    combine: "HEMORRHAGE_HEMOSTASIS_LAYER",
    contributors: () => Object.freeze([]),
  }),
  persistence: Object.freeze({ boundary: "RUNTIME_CHECKPOINT", detached: true }),
  idempotency: Object.freeze({ key: "COMMAND_ID", duplicateEffectAllowed: false }),
  visibility: Object.freeze({ assessment: true, debug: true }),
  regressionIsolation: Object.freeze({ absentFeatureChangesBaseline: false }),
});

export class TranexamicAcidRuntime {
  private readonly regimens = new Map<string, TranexamicAcidRegimenState>();
  private readonly commandResults = new Map<string, TranexamicAcidCommandResult>();
  private readonly events: TranexamicAcidRuntimeEvent[] = [];

  constructor(private readonly configuration: TranexamicAcidConfiguration = DEFAULT_TRANEXAMIC_ACID_CONFIGURATION) {
    this.assertConfiguration(configuration);
  }

  reset(): void { this.regimens.clear(); this.commandResults.clear(); this.events.length = 0; }

  execute(command: TranexamicAcidCommand, circulation?: CirculationState,
    authoritativeInjuryOnsetSimulationTimeSec?: number): TranexamicAcidCommandResult {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const errors = commandErrors(command);
    if (!errors.length && command.action === "START" && circulation?.patientId !== command.patientId) errors.push("INVALID_PATIENT");
    if (!errors.length && command.action === "START" && !this.resolveAccess(command, circulation)) errors.push("MISSING_VASCULAR_ACCESS");
    if (errors.length) return this.reject(command, errors[0]);
    const result = command.action === "START"
      ? this.start(command, circulation!, authoritativeInjuryOnsetSimulationTimeSec)
      : this.stop(command);
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  advanceTo(simulationTimeSec: number): TranexamicAcidRuntimeEvent[] {
    const generated: TranexamicAcidRuntimeEvent[] = [];
    for (const prior of this.orderedRegimens()) {
      if (prior.lifecycle === "STOPPED" || prior.lifecycle === "COMPLETED") continue;
      if (simulationTimeSec < prior.startedAtSimulationTimeSec) continue;
      const next = activeStateAt(prior, simulationTimeSec, this.configuration);
      const loadingCompletedAt = prior.phaseTransitionAtSimulationTimeSec;
      if (prior.lifecycle === "LOADING" && next.lifecycle !== "LOADING") {
        generated.push(this.event("TranexamicAcidMaintenanceStarted", next, loadingCompletedAt));
      }
      if (next.lifecycle === "COMPLETED") {
        generated.push(this.event("TranexamicAcidRegimenCompleted", next, next.completedAtSimulationTimeSec!));
      }
      this.regimens.set(prior.regimenId, next);
    }
    this.events.push(...generated);
    return structuredClone(generated);
  }

  projectionsAt(simulationTimeSec: number): readonly TranexamicAcidFeatureProjection[] {
    return this.orderedRegimens().map(prior => {
      const state = activeStateAt(prior, simulationTimeSec, this.configuration);
      return Object.freeze({
        featureId: TRANEXAMIC_ACID_FEATURE_ID,
        regimenId: state.regimenId,
        patientId: state.patientId,
        category: "ANTIFIBRINOLYTIC" as const,
        route: state.route,
        vascularAccessId: state.vascularAccessId,
        lifecycle: state.lifecycle,
        loadingStatus: state.loadingStatus,
        maintenanceStatus: state.maintenanceStatus,
        loadingDeliveredMg: state.loadingDeliveredMg,
        maintenanceDeliveredMg: state.maintenanceDeliveredMg,
        startedAtSimulationTimeSec: state.startedAtSimulationTimeSec,
        phaseTransitionAtSimulationTimeSec: state.phaseTransitionAtSimulationTimeSec,
        ...(state.stoppedAtSimulationTimeSec === undefined ? {} : { stoppedAtSimulationTimeSec: state.stoppedAtSimulationTimeSec }),
        ...(state.completedAtSimulationTimeSec === undefined ? {} : { completedAtSimulationTimeSec: state.completedAtSimulationTimeSec }),
        timingClassification: state.timingClassification,
        currentAntifibrinolyticEffect: tranexamicAcidEffectAt(state, simulationTimeSec, this.configuration),
      });
    });
  }

  eventForCommand(commandId: string): TranexamicAcidRuntimeEvent | undefined {
    return structuredClone(this.events.filter(event => event.commandId === commandId).at(-1));
  }

  snapshot(): TranexamicAcidRuntimeSnapshot | undefined {
    if (!this.regimens.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({ schemaVersion: 1, configuration: structuredClone(this.configuration),
      regimens: this.orderedRegimens().map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId))
        .map(item => structuredClone(item)), events: structuredClone(this.events) });
  }

  restore(snapshot?: TranexamicAcidRuntimeSnapshot): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || JSON.stringify(snapshot.configuration) !== JSON.stringify(this.configuration)) {
      throw new Error("TRANEXAMIC_ACID_CONFIGURATION_MISMATCH");
    }
    snapshot.regimens.forEach(item => this.regimens.set(item.regimenId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private start(command: TranexamicAcidCommand, circulation: CirculationState,
    authoritativeInjuryOnsetSimulationTimeSec?: number): TranexamicAcidCommandResult {
    if (this.orderedRegimens().some(item => item.patientId === command.patientId &&
      item.lifecycle !== "STOPPED" && item.lifecycle !== "COMPLETED")) return this.reject(command, "ALREADY_ACTIVE", false);
    if (this.regimens.has(command.regimenId)) return this.reject(command, "INVALID_STATE", false);
    const access = this.resolveAccess(command, circulation)!;
    const state: TranexamicAcidRegimenState = Object.freeze({
      schemaVersion: 1, featureId: TRANEXAMIC_ACID_FEATURE_ID, regimenId: command.regimenId,
      patientId: command.patientId, route: access.type === "IO" ? "IO" : "IV",
      vascularAccessId: command.vascularAccessId!, lifecycle: "LOADING",
      regimenVersion: TRANEXAMIC_ACID_REGIMEN_VERSION, loadingStatus: "RUNNING",
      maintenanceStatus: "NOT_STARTED", loadingDeliveredMg: 0, maintenanceDeliveredMg: 0,
      startedAtSimulationTimeSec: command.simulationTimeSec,
      phaseTransitionAtSimulationTimeSec: command.simulationTimeSec + this.configuration.loadingDurationSec,
      timingClassification: classifyTranexamicAcidTiming(command.simulationTimeSec,
        authoritativeInjuryOnsetSimulationTimeSec, this.configuration),
      ...(authoritativeInjuryOnsetSimulationTimeSec === undefined ? {}
        : { authoritativeInjuryOnsetSimulationTimeSec }),
    });
    this.regimens.set(state.regimenId, state);
    this.events.push(this.event("TranexamicAcidLoadingStarted", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private stop(command: TranexamicAcidCommand): TranexamicAcidCommandResult {
    const prior = this.regimens.get(command.regimenId);
    if (!prior) return this.reject(command, "REGIMEN_NOT_FOUND", false);
    if (prior.patientId !== command.patientId) return this.reject(command, "INVALID_STATE", false);
    if (command.simulationTimeSec < prior.startedAtSimulationTimeSec) return this.reject(command, "STALE_SIMULATION_TIME", false);
    if (prior.lifecycle === "STOPPED" || prior.lifecycle === "COMPLETED") {
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(prior) });
    }
    const current = activeStateAt(prior, command.simulationTimeSec, this.configuration);
    if (current.lifecycle === "COMPLETED") {
      this.regimens.set(current.regimenId, current);
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    }
    const effect = tranexamicAcidEffectAt(current, command.simulationTimeSec, this.configuration);
    const state: TranexamicAcidRegimenState = Object.freeze({ ...current, lifecycle: "STOPPED",
      loadingStatus: current.loadingStatus === "RUNNING" ? "STOPPED" : current.loadingStatus,
      maintenanceStatus: current.maintenanceStatus === "RUNNING" ? "STOPPED" : current.maintenanceStatus,
      stoppedAtSimulationTimeSec: command.simulationTimeSec, terminalEffectAnchor: effect });
    this.regimens.set(state.regimenId, state);
    this.events.push(this.event("TranexamicAcidRegimenStopped", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private resolveAccess(command: TranexamicAcidCommand, circulation?: CirculationState) {
    return circulation?.vascularAccess.find(access => access.interventionInstanceId === command.vascularAccessId);
  }

  private reject(command: TranexamicAcidCommand, reasonCode: TranexamicAcidRejectionReason,
    remember = true): TranexamicAcidCommandResult {
    const result: TranexamicAcidCommandResult = Object.freeze({ status: "REJECTED", commandId: command.commandId,
      rejectionReason: reasonCode });
    if (remember && command.commandId) this.commandResults.set(command.commandId, result);
    this.events.push(Object.freeze({ eventType: "TranexamicAcidCommandRejected", commandId: command.commandId,
      regimenId: command.regimenId, patientId: command.patientId, timestamp: command.simulationTimeSec,
      lifecycle: "STOPPED", loadingDeliveredMg: 0, maintenanceDeliveredMg: 0, reasonCode }));
    return structuredClone(result);
  }

  private event(eventType: TranexamicAcidRuntimeEvent["eventType"], state: TranexamicAcidRegimenState,
    timestamp: number, commandId?: string): TranexamicAcidRuntimeEvent {
    return Object.freeze({ eventType, commandId, regimenId: state.regimenId, patientId: state.patientId,
      timestamp, lifecycle: state.lifecycle, loadingDeliveredMg: state.loadingDeliveredMg,
      maintenanceDeliveredMg: state.maintenanceDeliveredMg });
  }

  private orderedRegimens(): TranexamicAcidRegimenState[] {
    return [...this.regimens.values()].sort((a, b) => a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec ||
      a.regimenId.localeCompare(b.regimenId));
  }

  private assertConfiguration(configuration: TranexamicAcidConfiguration): void {
    const values = [configuration.loadingDoseMg, configuration.loadingDurationSec,
      configuration.maintenanceDoseMg, configuration.maintenanceDurationSec,
      configuration.eligibleTraumaWindowSec, configuration.effectHalfLifeSec];
    if (configuration.schemaVersion !== 1 || configuration.regimenVersion !== TRANEXAMIC_ACID_REGIMEN_VERSION ||
      values.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error("TRANEXAMIC_ACID_CONFIGURATION_INVALID");
    }
  }
}
