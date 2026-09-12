import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalFeatureContract } from "@/models/ClinicalFeatureContract";
import {
  NOREPINEPHRINE_DOSE_UNIT,
  NOREPINEPHRINE_FEATURE_ID,
  type NorepinephrineCommand,
  type NorepinephrineCommandResult,
  type NorepinephrineConfiguration,
  type NorepinephrineFeatureProjection,
  type NorepinephrineInfusionState,
  type NorepinephrineRejectionReason,
  type NorepinephrineRuntimeEvent,
  type NorepinephrineRuntimeSnapshot,
} from "@/models/NorepinephrineInfusion";
import type { VitalSignContributor } from "@/models/VitalSign";
import { stableJson } from "@/utils/stableJson";

export const DEFAULT_NOREPINEPHRINE_CONFIGURATION: NorepinephrineConfiguration = Object.freeze({
  version: "NOREPINEPHRINE_PD_V1",
  minimumDoseMicrogramsPerKgMin: 0,
  minimumNonZeroDoseMicrogramsPerKgMin: 0.01,
  maximumDoseMicrogramsPerKgMin: 2,
  halfMaximumDoseMicrogramsPerKgMin: 0.1,
  maximumSystolicIncreaseMmHg: 50,
  maximumDiastolicIncreaseMmHg: 30,
  onsetDurationSec: 120,
  doseChangeDurationSec: 60,
  decayDurationSec: 120,
});

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smoothStep = (value: number): number => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};

export function norepinephrineTargetEffect(
  doseMicrogramsPerKgMin: number,
  configuration: NorepinephrineConfiguration = DEFAULT_NOREPINEPHRINE_CONFIGURATION,
): Readonly<{ systolicIncreaseMmHg: number; diastolicIncreaseMmHg: number }> {
  if (!Number.isFinite(doseMicrogramsPerKgMin) || doseMicrogramsPerKgMin <= 0) {
    return Object.freeze({ systolicIncreaseMmHg: 0, diastolicIncreaseMmHg: 0 });
  }
  const fraction = doseMicrogramsPerKgMin /
    (configuration.halfMaximumDoseMicrogramsPerKgMin + doseMicrogramsPerKgMin);
  return Object.freeze({
    systolicIncreaseMmHg: round(configuration.maximumSystolicIncreaseMmHg * fraction),
    diastolicIncreaseMmHg: round(configuration.maximumDiastolicIncreaseMmHg * fraction),
  });
}

export function norepinephrineEffectAt(
  state: NorepinephrineInfusionState,
  simulationTimeSec: number,
): Readonly<{ systolicIncreaseMmHg: number; diastolicIncreaseMmHg: number }> {
  const elapsed = Math.max(0, simulationTimeSec - state.transition.startedAtSimulationTimeSec);
  const progress = state.transition.durationSec === 0 ? 1 : smoothStep(elapsed / state.transition.durationSec);
  return Object.freeze({
    systolicIncreaseMmHg: round(state.transition.fromSystolicIncreaseMmHg +
      (state.transition.toSystolicIncreaseMmHg - state.transition.fromSystolicIncreaseMmHg) * progress),
    diastolicIncreaseMmHg: round(state.transition.fromDiastolicIncreaseMmHg +
      (state.transition.toDiastolicIncreaseMmHg - state.transition.fromDiastolicIncreaseMmHg) * progress),
  });
}

function validationErrors(command: NorepinephrineCommand, configuration: NorepinephrineConfiguration): string[] {
  const errors: string[] = [];
  if (!command.commandId || !command.infusionId || !command.patientId ||
    !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0) errors.push("INVALID_COMMAND");
  if (command.action !== "STOP") {
    if (command.unit !== NOREPINEPHRINE_DOSE_UNIT) errors.push("INVALID_UNIT");
    const dose = command.doseMicrogramsPerKgMin;
    if (typeof dose !== "number" || !Number.isFinite(dose) ||
      dose < configuration.minimumDoseMicrogramsPerKgMin ||
      dose > configuration.maximumDoseMicrogramsPerKgMin ||
      (dose > 0 && dose < configuration.minimumNonZeroDoseMicrogramsPerKgMin)) errors.push("INVALID_DOSE");
  }
  if (command.action === "START" && !command.vascularAccessId) errors.push("MISSING_VASCULAR_ACCESS");
  return [...new Set(errors)];
}

export const norepinephrineClinicalFeatureContract: ClinicalFeatureContract<
  typeof NOREPINEPHRINE_FEATURE_ID,
  NorepinephrineCommand,
  NorepinephrineInfusionState,
  NorepinephrineConfiguration
> = Object.freeze({
  featureId: NOREPINEPHRINE_FEATURE_ID,
  category: "MEDICATION",
  schemaVersion: 1,
  configuration: DEFAULT_NOREPINEPHRINE_CONFIGURATION,
  input: Object.freeze({
    unit: NOREPINEPHRINE_DOSE_UNIT,
    actions: Object.freeze(["START", "CHANGE_DOSE", "STOP"]),
    validate: (command: NorepinephrineCommand) => Object.freeze(validationErrors(command, DEFAULT_NOREPINEPHRINE_CONFIGURATION)),
  }),
  authoritativeState: Object.freeze({
    lifecycle: Object.freeze(["RUNNING", "STOPPING", "STOPPED"] as const),
    persistedFields: Object.freeze([
      "infusionId", "patientId", "status", "doseMicrogramsPerKgMin", "unit",
      "startedAtSimulationTimeSec", "lastDoseChangeAtSimulationTimeSec", "stoppedAtSimulationTimeSec", "transition",
    ]),
  }),
  determinism: Object.freeze({ clock: "SIMULATION_TIME", wallClockAllowed: false }),
  physiology: Object.freeze({
    order: Object.freeze([
      "UNDERLYING_PHYSIOLOGY",
      "HEMORRHAGE_SOURCE_CONTROL",
      "VOLUME_RESUSCITATION",
      "VASOPRESSOR",
      "FINAL_HEMODYNAMICS",
    ] as const),
    combine: "VITAL_SIGN_MEDICATION_LAYER",
    contributors: (state: NorepinephrineInfusionState, simulationTimeSec: number) =>
      norepinephrineVitalContributors(state, simulationTimeSec),
  }),
  persistence: Object.freeze({ boundary: "RUNTIME_CHECKPOINT", detached: true }),
  idempotency: Object.freeze({ key: "COMMAND_ID", duplicateEffectAllowed: false }),
  visibility: Object.freeze({ assessment: true, debug: true }),
  regressionIsolation: Object.freeze({ absentFeatureChangesBaseline: false }),
});

export function norepinephrineVitalContributors(
  state: NorepinephrineInfusionState,
  simulationTimeSec: number,
): readonly VitalSignContributor[] {
  const effect = norepinephrineEffectAt(state, simulationTimeSec);
  if (state.status === "STOPPED" || (effect.systolicIncreaseMmHg === 0 && effect.diastolicIncreaseMmHg === 0)) return [];
  return Object.freeze([
    Object.freeze({ contributorId: `${state.infusionId}:SBP`, sourceType: "CLINICAL_EFFECT", sourceId: state.infusionId,
      layer: "MEDICATION", vital: "systolicBp", operation: "DELTA", value: effect.systolicIncreaseMmHg }),
    Object.freeze({ contributorId: `${state.infusionId}:DBP`, sourceType: "CLINICAL_EFFECT", sourceId: state.infusionId,
      layer: "MEDICATION", vital: "diastolicBp", operation: "DELTA", value: effect.diastolicIncreaseMmHg }),
  ] satisfies VitalSignContributor[]);
}

export class NorepinephrineInfusionRuntime {
  private readonly infusions = new Map<string, NorepinephrineInfusionState>();
  private readonly commandResults = new Map<string, NorepinephrineCommandResult>();
  private readonly events: NorepinephrineRuntimeEvent[] = [];

  constructor(private readonly configuration: NorepinephrineConfiguration = DEFAULT_NOREPINEPHRINE_CONFIGURATION) {
    this.assertConfiguration(configuration);
  }

  reset(): void { this.infusions.clear(); this.commandResults.clear(); this.events.length = 0; }

  execute(command: NorepinephrineCommand, circulation?: CirculationState): NorepinephrineCommandResult {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const errors = validationErrors(command, this.configuration);
    if (!errors.length && command.action === "START" && !this.validAccess(command, circulation)) errors.push("MISSING_VASCULAR_ACCESS");
    if (errors.length) return this.reject(command, errors[0] as NorepinephrineRejectionReason);
    const result = command.action === "START" ? this.start(command)
      : command.action === "CHANGE_DOSE" ? this.changeDose(command) : this.stop(command);
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  advanceTo(simulationTimeSec: number): NorepinephrineRuntimeEvent[] {
    const generated: NorepinephrineRuntimeEvent[] = [];
    for (const state of this.orderedInfusions()) {
      if (state.status !== "STOPPING" || simulationTimeSec < state.transition.startedAtSimulationTimeSec + state.transition.durationSec) continue;
      const stopped: NorepinephrineInfusionState = Object.freeze({ ...state, status: "STOPPED" });
      this.infusions.set(state.infusionId, stopped);
      generated.push(this.event(
        "NorepinephrineInfusionStopped",
        stopped,
        state.transition.startedAtSimulationTimeSec + state.transition.durationSec,
      ));
    }
    this.events.push(...generated);
    return structuredClone(generated);
  }

  vitalContributorsAt(simulationTimeSec: number): readonly VitalSignContributor[] {
    return this.orderedInfusions().flatMap(state => norepinephrineVitalContributors(state, simulationTimeSec));
  }

  projectionsAt(simulationTimeSec: number): readonly NorepinephrineFeatureProjection[] {
    return this.orderedInfusions().map(state => {
      const effect = norepinephrineEffectAt(state, simulationTimeSec);
      return Object.freeze({
        featureId: NOREPINEPHRINE_FEATURE_ID,
        infusionId: state.infusionId,
        patientId: state.patientId,
        route: state.route,
        vascularAccessId: state.vascularAccessId,
        status: state.status,
        doseMicrogramsPerKgMin: state.doseMicrogramsPerKgMin,
        unit: state.unit,
        currentSystolicIncreaseMmHg: effect.systolicIncreaseMmHg,
        currentDiastolicIncreaseMmHg: effect.diastolicIncreaseMmHg,
        startedAtSimulationTimeSec: state.startedAtSimulationTimeSec,
        lastDoseChangeAtSimulationTimeSec: state.lastDoseChangeAtSimulationTimeSec,
        ...(state.stoppedAtSimulationTimeSec === undefined ? {} : { stoppedAtSimulationTimeSec: state.stoppedAtSimulationTimeSec }),
      });
    });
  }

  snapshot(): NorepinephrineRuntimeSnapshot | undefined {
    if (!this.infusions.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({ schemaVersion: 1, configuration: structuredClone(this.configuration),
      infusions: this.orderedInfusions().map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId)).map(item => structuredClone(item)),
      events: structuredClone(this.events) });
  }

  restore(snapshot?: NorepinephrineRuntimeSnapshot): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || stableJson(snapshot.configuration) !== stableJson(this.configuration)) {
      throw new Error("NOREPINEPHRINE_CONFIGURATION_MISMATCH");
    }
    snapshot.infusions.forEach(item => this.infusions.set(item.infusionId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private start(command: NorepinephrineCommand): NorepinephrineCommandResult {
    if (this.orderedInfusions().some(item => item.patientId === command.patientId && item.status !== "STOPPED")) {
      return this.reject(command, "ALREADY_ACTIVE", false);
    }
    if (this.infusions.has(command.infusionId)) return this.reject(command, "INVALID_STATE", false);
    const target = norepinephrineTargetEffect(command.doseMicrogramsPerKgMin!, this.configuration);
    const state: NorepinephrineInfusionState = Object.freeze({
      schemaVersion: 1, featureId: NOREPINEPHRINE_FEATURE_ID, infusionId: command.infusionId,
      patientId: command.patientId, route: "IV", vascularAccessId: command.vascularAccessId!, status: "RUNNING",
      doseMicrogramsPerKgMin: command.doseMicrogramsPerKgMin!, unit: NOREPINEPHRINE_DOSE_UNIT,
      startedAtSimulationTimeSec: command.simulationTimeSec, lastDoseChangeAtSimulationTimeSec: command.simulationTimeSec,
      transition: Object.freeze({ startedAtSimulationTimeSec: command.simulationTimeSec,
        durationSec: this.configuration.onsetDurationSec, fromSystolicIncreaseMmHg: 0,
        toSystolicIncreaseMmHg: target.systolicIncreaseMmHg, fromDiastolicIncreaseMmHg: 0,
        toDiastolicIncreaseMmHg: target.diastolicIncreaseMmHg }),
    });
    this.infusions.set(state.infusionId, state);
    this.events.push(this.event("NorepinephrineInfusionStarted", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private changeDose(command: NorepinephrineCommand): NorepinephrineCommandResult {
    const current = this.infusions.get(command.infusionId);
    if (!current) return this.reject(command, "INFUSION_NOT_FOUND", false);
    if (current.patientId !== command.patientId || current.status !== "RUNNING") return this.reject(command, "INVALID_STATE", false);
    if (command.simulationTimeSec < current.lastDoseChangeAtSimulationTimeSec) return this.reject(command, "STALE_SIMULATION_TIME", false);
    if (current.doseMicrogramsPerKgMin === command.doseMicrogramsPerKgMin) {
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    }
    const from = norepinephrineEffectAt(current, command.simulationTimeSec);
    const target = norepinephrineTargetEffect(command.doseMicrogramsPerKgMin!, this.configuration);
    const state: NorepinephrineInfusionState = Object.freeze({ ...current,
      doseMicrogramsPerKgMin: command.doseMicrogramsPerKgMin!, lastDoseChangeAtSimulationTimeSec: command.simulationTimeSec,
      transition: Object.freeze({ startedAtSimulationTimeSec: command.simulationTimeSec,
        durationSec: this.configuration.doseChangeDurationSec,
        fromSystolicIncreaseMmHg: from.systolicIncreaseMmHg, toSystolicIncreaseMmHg: target.systolicIncreaseMmHg,
        fromDiastolicIncreaseMmHg: from.diastolicIncreaseMmHg, toDiastolicIncreaseMmHg: target.diastolicIncreaseMmHg }),
    });
    this.infusions.set(state.infusionId, state);
    this.events.push(this.event("NorepinephrineDoseChanged", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private stop(command: NorepinephrineCommand): NorepinephrineCommandResult {
    const current = this.infusions.get(command.infusionId);
    if (!current) return this.reject(command, "INFUSION_NOT_FOUND", false);
    if (current.patientId !== command.patientId) return this.reject(command, "INVALID_STATE", false);
    if (current.status !== "RUNNING") return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    if (command.simulationTimeSec < current.lastDoseChangeAtSimulationTimeSec) return this.reject(command, "STALE_SIMULATION_TIME", false);
    const from = norepinephrineEffectAt(current, command.simulationTimeSec);
    const zero = from.systolicIncreaseMmHg === 0 && from.diastolicIncreaseMmHg === 0;
    const state: NorepinephrineInfusionState = Object.freeze({ ...current, status: zero ? "STOPPED" : "STOPPING",
      doseMicrogramsPerKgMin: 0, lastDoseChangeAtSimulationTimeSec: command.simulationTimeSec,
      stoppedAtSimulationTimeSec: command.simulationTimeSec,
      transition: Object.freeze({ startedAtSimulationTimeSec: command.simulationTimeSec,
        durationSec: zero ? 0 : this.configuration.decayDurationSec,
        fromSystolicIncreaseMmHg: from.systolicIncreaseMmHg, toSystolicIncreaseMmHg: 0,
        fromDiastolicIncreaseMmHg: from.diastolicIncreaseMmHg, toDiastolicIncreaseMmHg: 0 }),
    });
    this.infusions.set(state.infusionId, state);
    this.events.push(this.event(zero ? "NorepinephrineInfusionStopped" : "NorepinephrineInfusionStopping",
      state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private reject(command: NorepinephrineCommand, reasonCode: NorepinephrineRejectionReason, remember = true): NorepinephrineCommandResult {
    const result: NorepinephrineCommandResult = Object.freeze({ status: "REJECTED", commandId: command.commandId, rejectionReason: reasonCode });
    if (remember && command.commandId) this.commandResults.set(command.commandId, result);
    this.events.push(Object.freeze({ eventType: "NorepinephrineCommandRejected", commandId: command.commandId,
      infusionId: command.infusionId, patientId: command.patientId, timestamp: command.simulationTimeSec,
      doseMicrogramsPerKgMin: Number.isFinite(command.doseMicrogramsPerKgMin) ? command.doseMicrogramsPerKgMin! : 0,
      unit: NOREPINEPHRINE_DOSE_UNIT, reasonCode }));
    return structuredClone(result);
  }

  private event(eventType: NorepinephrineRuntimeEvent["eventType"], state: NorepinephrineInfusionState,
    timestamp: number, commandId?: string): NorepinephrineRuntimeEvent {
    return Object.freeze({ eventType, commandId, infusionId: state.infusionId, patientId: state.patientId,
      timestamp, doseMicrogramsPerKgMin: state.doseMicrogramsPerKgMin, unit: NOREPINEPHRINE_DOSE_UNIT });
  }

  private orderedInfusions(): NorepinephrineInfusionState[] {
    return [...this.infusions.values()].sort((a, b) => a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec || a.infusionId.localeCompare(b.infusionId));
  }

  private validAccess(command: NorepinephrineCommand, circulation?: CirculationState): boolean {
    return Boolean(circulation?.vascularAccess.some(access =>
      access.interventionInstanceId === command.vascularAccessId && access.type !== "IO"));
  }

  private assertConfiguration(configuration: NorepinephrineConfiguration): void {
    const values = Object.values(configuration).filter((value): value is number => typeof value === "number");
    if (values.some(value => !Number.isFinite(value) || value < 0) ||
      configuration.minimumDoseMicrogramsPerKgMin > configuration.minimumNonZeroDoseMicrogramsPerKgMin ||
      configuration.minimumNonZeroDoseMicrogramsPerKgMin > configuration.maximumDoseMicrogramsPerKgMin ||
      configuration.halfMaximumDoseMicrogramsPerKgMin <= 0) throw new Error("NOREPINEPHRINE_CONFIGURATION_INVALID");
  }
}
