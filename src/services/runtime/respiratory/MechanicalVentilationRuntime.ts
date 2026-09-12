import type { AirwayState } from "@/models/AirwayState";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type {
  ExternalMechanicalVentilationSupport,
  MechanicalVentilationCommand,
  MechanicalVentilationCommandResult,
  MechanicalVentilationConfiguration,
  MechanicalVentilationFeatureProjection,
  MechanicalVentilationRejectionReason,
  MechanicalVentilationRuntimeEvent,
  MechanicalVentilationRuntimeSnapshot,
  MechanicalVentilationSettings,
  MechanicalVentilationState,
} from "@/models/MechanicalVentilation";
import {
  MECHANICAL_VENTILATION_FEATURE_ID,
  PEEP_UNIT,
  TIDAL_VOLUME_UNIT,
  VENTILATION_RATE_UNIT,
  VOLUME_CONTROL_MODE,
} from "@/models/MechanicalVentilation";
import type { VitalSignContributor } from "@/models/VitalSign";
import type { ClinicalFeatureContract } from "@/models/ClinicalFeatureContract";
import { stableJson } from "@/utils/stableJson";

export const DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION: MechanicalVentilationConfiguration = Object.freeze({
  schemaVersion: 1,
  version: "MECHANICAL_VENTILATION_V1",
  minimumRespiratoryRate: 1,
  maximumRespiratoryRate: 60,
  minimumTidalVolumeMl: 50,
  maximumTidalVolumeMl: 1500,
  minimumFio2: 0.21,
  maximumFio2: 1,
  minimumPeepCmH2O: 0,
  maximumPeepCmH2O: 30,
});

export type SecuredAirwayReference = Readonly<{
  instanceId: string;
  patientId: string;
  definitionId: string;
  status: "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
  airwayState: AirwayState;
}>;

export type MechanicalVentilationProjectionContext = Readonly<{
  airwayValid: boolean;
  spontaneousRespiratoryRate?: number;
  medicationRespiratoryDepression?: number;
}>;

const precise = (value: number): number => Number(value.toFixed(6));

export function mechanicalMinuteVentilationLMin(settings: Pick<MechanicalVentilationSettings,
  "respiratoryRate" | "tidalVolumeMl">): number {
  return precise(settings.respiratoryRate * settings.tidalVolumeMl / 1000);
}

export function externalMechanicalVentilationSupportFromEffects(
  effects: readonly ClinicalEffect[], patientId: string,
): ExternalMechanicalVentilationSupport | undefined {
  const effect = effects.filter(item => item.effectType === "EXTERNAL_MECHANICAL_VENTILATION" &&
    item.patientId === patientId).sort((a, b) => a.sourceInterventionInstanceId.localeCompare(
    b.sourceInterventionInstanceId))[0];
  if (!effect) return undefined;
  const respiratoryRate = Number(effect.parameters.respiratoryRate);
  const tidalVolumeMl = Number(effect.parameters.tidalVolumeMl);
  const mechanicalMinuteVentilation = Number(effect.parameters.mechanicalMinuteVentilationLMin);
  const fio2 = Number(effect.parameters.fio2);
  const peepCmH2O = Number(effect.parameters.peepCmH2O);
  if ([respiratoryRate, tidalVolumeMl, mechanicalMinuteVentilation, fio2, peepCmH2O]
    .some(value => !Number.isFinite(value))) return undefined;
  return Object.freeze({ supportId: effect.sourceInterventionInstanceId, patientId,
    respiratoryRate, tidalVolumeMl, mechanicalMinuteVentilationLMin: mechanicalMinuteVentilation,
    fio2, peepCmH2O });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function settingsEqual(left: MechanicalVentilationSettings, right: MechanicalVentilationSettings): boolean {
  return left.mode === right.mode && left.respiratoryRate === right.respiratoryRate &&
    left.respiratoryRateUnit === right.respiratoryRateUnit && left.tidalVolumeMl === right.tidalVolumeMl &&
    left.tidalVolumeUnit === right.tidalVolumeUnit && left.fio2 === right.fio2 &&
    left.peepCmH2O === right.peepCmH2O && left.peepUnit === right.peepUnit;
}

function settingErrors(settings: MechanicalVentilationSettings | undefined,
  configuration: MechanicalVentilationConfiguration): MechanicalVentilationRejectionReason[] {
  if (!settings) return ["INVALID_COMMAND"];
  const errors: MechanicalVentilationRejectionReason[] = [];
  if (settings.mode !== VOLUME_CONTROL_MODE) errors.push("INVALID_MODE");
  if (settings.respiratoryRateUnit !== VENTILATION_RATE_UNIT || settings.tidalVolumeUnit !== TIDAL_VOLUME_UNIT ||
    settings.peepUnit !== PEEP_UNIT) errors.push("INVALID_UNIT");
  if (!isFiniteNumber(settings.respiratoryRate) || settings.respiratoryRate < configuration.minimumRespiratoryRate ||
    settings.respiratoryRate > configuration.maximumRespiratoryRate) errors.push("INVALID_RESPIRATORY_RATE");
  if (!isFiniteNumber(settings.tidalVolumeMl) || settings.tidalVolumeMl < configuration.minimumTidalVolumeMl ||
    settings.tidalVolumeMl > configuration.maximumTidalVolumeMl) errors.push("INVALID_TIDAL_VOLUME");
  if (!isFiniteNumber(settings.fio2) || settings.fio2 < configuration.minimumFio2 ||
    settings.fio2 > configuration.maximumFio2) errors.push("INVALID_FIO2");
  if (!isFiniteNumber(settings.peepCmH2O) || settings.peepCmH2O < configuration.minimumPeepCmH2O ||
    settings.peepCmH2O > configuration.maximumPeepCmH2O) errors.push("INVALID_PEEP");
  return [...new Set(errors)];
}

function validSecuredAirway(command: MechanicalVentilationCommand,
  airway?: SecuredAirwayReference): MechanicalVentilationRejectionReason | undefined {
  if (!command.securedAirwayId || !airway) return "MISSING_SECURED_AIRWAY";
  if (airway.patientId !== command.patientId || airway.airwayState.patientId !== command.patientId) {
    return "INVALID_PATIENT";
  }
  if (airway.instanceId !== command.securedAirwayId || airway.definitionId !== "ENDOTRACHEAL_INTUBATION" ||
    airway.status !== "RUNNING" || airway.airwayState.activeAirway !== "ENDOTRACHEAL" ||
    !airway.airwayState.confirmed) return "MISSING_SECURED_AIRWAY";
  return undefined;
}

export function mechanicalVentilationVitalContributors(
  projection: MechanicalVentilationFeatureProjection,
): readonly VitalSignContributor[] {
  if (!projection.externalSupportActive) return [];
  return Object.freeze([Object.freeze({
    contributorId: `${MECHANICAL_VENTILATION_FEATURE_ID}:${projection.supportId}:RESPIRATORY_RATE`,
    sourceType: "CLINICAL_EFFECT" as const,
    sourceId: projection.supportId,
    layer: "EXTERNAL_RESPIRATORY_SUPPORT" as const,
    vital: "respiratoryRate" as const,
    operation: "TARGET" as const,
    value: projection.respiratoryRate,
  })]);
}

export const mechanicalVentilationClinicalFeatureContract: ClinicalFeatureContract<
  typeof MECHANICAL_VENTILATION_FEATURE_ID,
  MechanicalVentilationCommand,
  MechanicalVentilationState,
  MechanicalVentilationConfiguration
> = Object.freeze({
  featureId: MECHANICAL_VENTILATION_FEATURE_ID,
  category: "VENTILATION",
  schemaVersion: 1,
  configuration: DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION,
  input: Object.freeze({
    unit: `${VENTILATION_RATE_UNIT}/${TIDAL_VOLUME_UNIT}/${PEEP_UNIT}`,
    actions: Object.freeze(["START", "CHANGE_SETTINGS", "STOP"]),
    validate: (command: MechanicalVentilationCommand) => Object.freeze(
      command.action === "STOP" ? [] : settingErrors(command.settings, DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION),
    ),
  }),
  authoritativeState: Object.freeze({
    lifecycle: Object.freeze(["RUNNING", "STOPPED"] as const),
    persistedFields: Object.freeze([
      "supportId", "patientId", "securedAirwayId", "mode", "lifecycle", "respiratoryRate",
      "respiratoryRateUnit", "tidalVolumeMl", "tidalVolumeUnit", "fio2", "peepCmH2O", "peepUnit",
      "startedAtSimulationTimeSec", "lastSettingsChangeAtSimulationTimeSec", "stoppedAtSimulationTimeSec",
      "stopReason",
    ]),
  }),
  determinism: Object.freeze({ clock: "SIMULATION_TIME", wallClockAllowed: false }),
  physiology: Object.freeze({
    order: Object.freeze(["SPONTANEOUS_RESPIRATORY_DRIVE", "MEDICATION_CNS_RESPIRATORY",
      "EXTERNAL_RESPIRATORY_SUPPORT", "INSPIRED_OXYGEN", "FINAL_RESPIRATORY_STATE"] as const),
    combine: "EXTERNAL_RESPIRATORY_SUPPORT_FLOOR",
    contributors: () => Object.freeze([]),
  }),
  persistence: Object.freeze({ boundary: "RUNTIME_CHECKPOINT", detached: true }),
  idempotency: Object.freeze({ key: "COMMAND_ID", duplicateEffectAllowed: false }),
  visibility: Object.freeze({ assessment: true, debug: true }),
  regressionIsolation: Object.freeze({ absentFeatureChangesBaseline: false }),
});

export class MechanicalVentilationRuntime {
  private readonly supports = new Map<string, MechanicalVentilationState>();
  private readonly commandResults = new Map<string, MechanicalVentilationCommandResult>();
  private readonly events: MechanicalVentilationRuntimeEvent[] = [];

  constructor(private readonly configuration = DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION) {}

  reset(): void {
    this.supports.clear(); this.commandResults.clear(); this.events.length = 0;
  }

  execute(command: MechanicalVentilationCommand,
    airway?: SecuredAirwayReference): MechanicalVentilationCommandResult {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const errors: MechanicalVentilationRejectionReason[] = [];
    if (!command.commandId || !command.supportId || !command.patientId ||
      !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0 ||
      !["START", "CHANGE_SETTINGS", "STOP"].includes(command.action)) errors.push("INVALID_COMMAND");
    if (command.action !== "STOP") errors.push(...settingErrors(command.settings, this.configuration));
    if (command.action === "START") {
      const airwayError = validSecuredAirway(command, airway);
      if (airwayError) errors.push(airwayError);
    }
    if (errors.length) return this.reject(command, errors[0]);
    const result = command.action === "START" ? this.start(command)
      : command.action === "CHANGE_SETTINGS" ? this.changeSettings(command) : this.stop(command);
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  reconcileAirway(patientId: string, validSupportIds: ReadonlySet<string>,
    simulationTimeSec: number): readonly MechanicalVentilationRuntimeEvent[] {
    const generated: MechanicalVentilationRuntimeEvent[] = [];
    for (const state of this.orderedSupports()) {
      if (state.patientId !== patientId || state.lifecycle !== "RUNNING" || validSupportIds.has(state.securedAirwayId)) continue;
      const stopped = Object.freeze({ ...state, lifecycle: "STOPPED" as const,
        stoppedAtSimulationTimeSec: simulationTimeSec, stopReason: "AIRWAY_LOST" as const });
      this.supports.set(state.supportId, stopped);
      generated.push(this.event("MechanicalVentilationStopped", stopped, simulationTimeSec, undefined, "AIRWAY_LOST"));
    }
    this.events.push(...generated);
    return structuredClone(generated);
  }

  projectionsAt(simulationTimeSec: number,
    contextFor: (state: MechanicalVentilationState) => MechanicalVentilationProjectionContext):
    readonly MechanicalVentilationFeatureProjection[] {
    return this.orderedSupports().map(state => {
      const context = contextFor(state);
      const externalSupportActive = state.lifecycle === "RUNNING" && context.airwayValid;
      return Object.freeze({
        featureId: MECHANICAL_VENTILATION_FEATURE_ID,
        supportId: state.supportId,
        patientId: state.patientId,
        securedAirwayId: state.securedAirwayId,
        mode: state.mode,
        lifecycle: state.lifecycle,
        airwayValid: context.airwayValid,
        externalSupportActive,
        respiratoryRate: state.respiratoryRate,
        respiratoryRateUnit: state.respiratoryRateUnit,
        tidalVolumeMl: state.tidalVolumeMl,
        tidalVolumeUnit: state.tidalVolumeUnit,
        mechanicalMinuteVentilationLMin: externalSupportActive ? mechanicalMinuteVentilationLMin(state) : 0,
        fio2: state.fio2,
        peepCmH2O: state.peepCmH2O,
        peepUnit: state.peepUnit,
        peepPhysiologicEffect: "DEFERRED_NO_GENERIC_RECRUITMENT_MODEL" as const,
        ...(context.spontaneousRespiratoryRate === undefined ? {} : {
          spontaneousRespiratoryRate: context.spontaneousRespiratoryRate,
        }),
        medicationRespiratoryDepression: precise(context.medicationRespiratoryDepression ?? 0),
        effectiveRespiratoryRate: externalSupportActive
          ? Math.max(context.spontaneousRespiratoryRate ?? 0, state.respiratoryRate)
          : context.spontaneousRespiratoryRate ?? 0,
        startedAtSimulationTimeSec: state.startedAtSimulationTimeSec,
        lastSettingsChangeAtSimulationTimeSec: state.lastSettingsChangeAtSimulationTimeSec,
        ...(state.stoppedAtSimulationTimeSec === undefined ? {} : {
          stoppedAtSimulationTimeSec: state.stoppedAtSimulationTimeSec,
        }),
        ...(state.stopReason === undefined ? {} : { stopReason: state.stopReason }),
      });
    });
  }

  activeSupport(patientId: string, airwayValid: (state: MechanicalVentilationState) => boolean):
    ExternalMechanicalVentilationSupport | undefined {
    const state = this.orderedSupports().find(item => item.patientId === patientId && item.lifecycle === "RUNNING" &&
      airwayValid(item));
    return state ? Object.freeze({ supportId: state.supportId, patientId: state.patientId,
      respiratoryRate: state.respiratoryRate, tidalVolumeMl: state.tidalVolumeMl,
      mechanicalMinuteVentilationLMin: mechanicalMinuteVentilationLMin(state), fio2: state.fio2,
      peepCmH2O: state.peepCmH2O }) : undefined;
  }

  activeEffects(airwayValid: (state: MechanicalVentilationState) => boolean): readonly ClinicalEffect[] {
    return this.orderedSupports().filter(state => state.lifecycle === "RUNNING" && airwayValid(state)).map(state => ({
      effectId: `${MECHANICAL_VENTILATION_FEATURE_ID}:${state.supportId}`,
      effectType: "EXTERNAL_MECHANICAL_VENTILATION" as const,
      encounterId: state.patientId,
      patientId: state.patientId,
      timestamp: state.lastSettingsChangeAtSimulationTimeSec,
      sourceInterventionInstanceId: state.supportId,
      parameters: { mode: state.mode, respiratoryRate: state.respiratoryRate,
        tidalVolumeMl: state.tidalVolumeMl, mechanicalMinuteVentilationLMin: mechanicalMinuteVentilationLMin(state),
        fio2: state.fio2, peepCmH2O: state.peepCmH2O },
    }));
  }

  vitalContributorsAt(simulationTimeSec: number,
    contextFor: (state: MechanicalVentilationState) => MechanicalVentilationProjectionContext):
    readonly VitalSignContributor[] {
    return this.projectionsAt(simulationTimeSec, contextFor).flatMap(mechanicalVentilationVitalContributors);
  }

  eventForCommand(commandId: string): MechanicalVentilationRuntimeEvent | undefined {
    return structuredClone(this.events.filter(event => event.commandId === commandId).at(-1));
  }

  snapshot(): MechanicalVentilationRuntimeSnapshot | undefined {
    if (!this.supports.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({ schemaVersion: 1, configuration: structuredClone(this.configuration),
      supports: this.orderedSupports().map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId))
        .map(item => structuredClone(item)), events: structuredClone(this.events) });
  }

  restore(snapshot?: MechanicalVentilationRuntimeSnapshot): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || stableJson(snapshot.configuration) !== stableJson(this.configuration)) {
      throw new Error("MECHANICAL_VENTILATION_CONFIGURATION_MISMATCH");
    }
    snapshot.supports.forEach(item => this.supports.set(item.supportId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private start(command: MechanicalVentilationCommand): MechanicalVentilationCommandResult {
    if (this.orderedSupports().some(item => item.patientId === command.patientId && item.lifecycle === "RUNNING")) {
      return this.reject(command, "ALREADY_ACTIVE", false);
    }
    if (this.supports.has(command.supportId)) return this.reject(command, "INVALID_STATE", false);
    const settings = command.settings!;
    const state: MechanicalVentilationState = Object.freeze({ schemaVersion: 1,
      featureId: MECHANICAL_VENTILATION_FEATURE_ID, supportId: command.supportId, patientId: command.patientId,
      securedAirwayId: command.securedAirwayId!, lifecycle: "RUNNING", ...structuredClone(settings),
      startedAtSimulationTimeSec: command.simulationTimeSec,
      lastSettingsChangeAtSimulationTimeSec: command.simulationTimeSec });
    this.supports.set(state.supportId, state);
    this.events.push(this.event("MechanicalVentilationStarted", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private changeSettings(command: MechanicalVentilationCommand): MechanicalVentilationCommandResult {
    const current = this.supports.get(command.supportId);
    if (!current) return this.reject(command, "SUPPORT_NOT_FOUND", false);
    if (current.patientId !== command.patientId || current.lifecycle !== "RUNNING") {
      return this.reject(command, "INVALID_STATE", false);
    }
    if (command.simulationTimeSec < current.lastSettingsChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", false);
    }
    const settings = command.settings!;
    if (settingsEqual(settings, current)) {
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    }
    const state: MechanicalVentilationState = Object.freeze({ ...current, ...structuredClone(settings),
      lastSettingsChangeAtSimulationTimeSec: command.simulationTimeSec });
    this.supports.set(state.supportId, state);
    this.events.push(this.event("MechanicalVentilationSettingsChanged", state, command.simulationTimeSec,
      command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private stop(command: MechanicalVentilationCommand): MechanicalVentilationCommandResult {
    const current = this.supports.get(command.supportId);
    if (!current) return this.reject(command, "SUPPORT_NOT_FOUND", false);
    if (current.patientId !== command.patientId) return this.reject(command, "INVALID_STATE", false);
    if (current.lifecycle === "STOPPED") return Object.freeze({ status: "NO_OP", commandId: command.commandId,
      state: structuredClone(current) });
    if (command.simulationTimeSec < current.lastSettingsChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", false);
    }
    const state: MechanicalVentilationState = Object.freeze({ ...current, lifecycle: "STOPPED",
      stoppedAtSimulationTimeSec: command.simulationTimeSec, stopReason: "COMMAND" });
    this.supports.set(state.supportId, state);
    this.events.push(this.event("MechanicalVentilationStopped", state, command.simulationTimeSec, command.commandId,
      "COMMAND"));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private reject(command: MechanicalVentilationCommand, reasonCode: MechanicalVentilationRejectionReason,
    remember = true): MechanicalVentilationCommandResult {
    const result: MechanicalVentilationCommandResult = Object.freeze({ status: "REJECTED",
      commandId: command.commandId, rejectionReason: reasonCode });
    if (remember && command.commandId) this.commandResults.set(command.commandId, result);
    this.events.push(Object.freeze({ eventType: "MechanicalVentilationCommandRejected", commandId: command.commandId,
      supportId: command.supportId, patientId: command.patientId, timestamp: command.simulationTimeSec,
      lifecycle: "STOPPED", reasonCode }));
    return structuredClone(result);
  }

  private event(eventType: MechanicalVentilationRuntimeEvent["eventType"], state: MechanicalVentilationState,
    timestamp: number, commandId?: string, reasonCode?: "COMMAND" | "AIRWAY_LOST"):
    MechanicalVentilationRuntimeEvent {
    return Object.freeze({ eventType, commandId, supportId: state.supportId, patientId: state.patientId,
      timestamp, lifecycle: state.lifecycle, ...(reasonCode ? { reasonCode } : {}) });
  }

  private orderedSupports(): MechanicalVentilationState[] {
    return [...this.supports.values()].sort((a, b) => a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec ||
      a.supportId.localeCompare(b.supportId));
  }
}
