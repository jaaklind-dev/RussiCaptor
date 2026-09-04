import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalFeatureContract } from "@/models/ClinicalFeatureContract";
import {
  FLUID_RATE_UNIT,
  FLUID_VOLUME_UNIT,
  type FluidProductClass,
  type FluidTherapyAdministrationState,
  type FluidTherapyCommand,
  type FluidTherapyCommandResult,
  type FluidTherapyConfiguration,
  type FluidTherapyFeatureProjection,
  type FluidTherapyRejectionReason,
  type FluidTherapyRuntimeEvent,
  type FluidTherapyRuntimeSnapshot,
} from "@/models/FluidTherapy";
import type { VitalSignContributor, VitalSignKey } from "@/models/VitalSign";

const precise = (value: number): number => Number(value.toFixed(6));

export function deliveredFluidVolumeAt<TFluidType extends string>(
  state: FluidTherapyAdministrationState<TFluidType>,
  simulationTimeSec: number,
): number {
  if (state.status !== "RUNNING") return state.deliveredVolumeMl;
  const elapsedSec = Math.max(0, simulationTimeSec - state.lastRateChangeAtSimulationTimeSec);
  const unbounded = state.deliveredVolumeAtLastChangeMl + state.rateMlHour * elapsedSec / 3600;
  return precise(state.mode === "BOLUS"
    ? Math.min(state.prescribedVolumeMl ?? 0, unbounded)
    : unbounded);
}

export function effectiveIntravascularVolumeMl<TFluidType extends string>(
  deliveredVolumeMl: number,
  configuration: FluidTherapyConfiguration<TFluidType>,
): number {
  return precise(Math.max(0, deliveredVolumeMl) * configuration.effectiveIntravascularFraction);
}

export function fluidVolumeVitalContributors<TFluidType extends string>(
  projection: FluidTherapyFeatureProjection<TFluidType>,
  configuration: FluidTherapyConfiguration<TFluidType>,
): readonly VitalSignContributor[] {
  if (projection.effectiveIntravascularVolumeMl <= 0) return [];
  const factor = projection.effectiveIntravascularVolumeMl / 1000;
  const response = configuration.vitalResponsePer1000EffectiveMl;
  const values: readonly [VitalSignKey, number][] = [
    ["heartRate", response.heartRateDelta * factor],
    ["systolicBp", response.systolicBpDelta * factor],
    ["diastolicBp", response.diastolicBpDelta * factor],
    ["crt", response.crtDelta * factor],
  ];
  return Object.freeze(values.map(([vital, value]) => Object.freeze({
    contributorId: `${projection.administrationId}:${vital}`,
    sourceType: "CLINICAL_EFFECT" as const,
    sourceId: projection.administrationId,
    layer: "VOLUME_RESUSCITATION" as const,
    vital,
    operation: "DELTA" as const,
    value: precise(value),
  })));
}

function validate<TFluidType extends string>(
  command: FluidTherapyCommand<TFluidType>,
  configuration: FluidTherapyConfiguration<TFluidType>,
): FluidTherapyRejectionReason[] {
  const errors: FluidTherapyRejectionReason[] = [];
  if (!command.commandId || !command.administrationId || !command.patientId ||
    !Number.isFinite(command.simulationTimeSec) || command.simulationTimeSec < 0) errors.push("INVALID_COMMAND");
  if (!["START", "CHANGE_RATE", "STOP"].includes(command.action)) errors.push("INVALID_COMMAND");
  if (command.fluidType !== configuration.fluidType) errors.push("INVALID_FLUID_TYPE");
  if (command.action !== "STOP") {
    if (command.rateUnit !== FLUID_RATE_UNIT) errors.push("INVALID_UNIT");
    if (typeof command.rateMlHour !== "number" || !Number.isFinite(command.rateMlHour) ||
      command.rateMlHour <= 0 || command.rateMlHour > configuration.maximumRateMlHour) errors.push("INVALID_RATE");
  }
  if (command.action === "START") {
    if (command.mode !== "BOLUS" && command.mode !== "INFUSION") errors.push("INVALID_MODE");
    if (!command.vascularAccessId) errors.push("MISSING_VASCULAR_ACCESS");
    if (command.mode === "BOLUS") {
      if (command.volumeUnit !== FLUID_VOLUME_UNIT) errors.push("INVALID_UNIT");
      if (typeof command.prescribedVolumeMl !== "number" || !Number.isFinite(command.prescribedVolumeMl) ||
        command.prescribedVolumeMl <= 0 || command.prescribedVolumeMl > configuration.maximumPrescribedVolumeMl) {
        errors.push("INVALID_VOLUME");
      }
    }
  }
  return [...new Set(errors)];
}

export function createFluidTherapyContract<TFluidType extends string>(
  configuration: FluidTherapyConfiguration<TFluidType>,
  fluidClass: FluidProductClass = "CRYSTALLOID",
): ClinicalFeatureContract<TFluidType, FluidTherapyCommand<TFluidType>,
  FluidTherapyAdministrationState<TFluidType>, FluidTherapyConfiguration<TFluidType>> {
  return Object.freeze({
    featureId: configuration.fluidType,
    category: "FLUID",
    schemaVersion: configuration.schemaVersion,
    configuration,
    input: Object.freeze({
      unit: `${FLUID_VOLUME_UNIT}/${FLUID_RATE_UNIT}`,
      actions: Object.freeze(["START", "CHANGE_RATE", "STOP"]),
      validate: (command: FluidTherapyCommand<TFluidType>) => Object.freeze(validate(command, configuration)),
    }),
    authoritativeState: Object.freeze({
      lifecycle: Object.freeze(["RUNNING", "STOPPED", "COMPLETED"] as const),
      persistedFields: Object.freeze([
        "administrationId", "patientId", "fluidType", "vascularAccessId", "mode", "status",
        "prescribedVolumeMl", "rateMlHour", "deliveredVolumeMl", "deliveredVolumeAtLastChangeMl",
        "startedAtSimulationTimeSec", "lastRateChangeAtSimulationTimeSec",
        "stoppedAtSimulationTimeSec", "completedAtSimulationTimeSec",
      ]),
    }),
    determinism: Object.freeze({ clock: "SIMULATION_TIME", wallClockAllowed: false }),
    physiology: Object.freeze({
      order: Object.freeze([
        "UNDERLYING_PHYSIOLOGY", "HEMORRHAGE_SOURCE_CONTROL", "VOLUME_RESUSCITATION",
        "VASOPRESSOR", "FINAL_HEMODYNAMICS",
      ] as const),
      combine: "VITAL_SIGN_VOLUME_LAYER",
      contributors: (state: FluidTherapyAdministrationState<TFluidType>, simulationTimeSec: number) => {
        const projection = projectState(state, simulationTimeSec, configuration, fluidClass);
        return fluidVolumeVitalContributors(projection, configuration);
      },
    }),
    persistence: Object.freeze({ boundary: "RUNTIME_CHECKPOINT", detached: true }),
    idempotency: Object.freeze({ key: "COMMAND_ID", duplicateEffectAllowed: false }),
    visibility: Object.freeze({ assessment: true, debug: true }),
    regressionIsolation: Object.freeze({ absentFeatureChangesBaseline: false }),
  });
}

function projectState<TFluidType extends string>(
  state: FluidTherapyAdministrationState<TFluidType>,
  simulationTimeSec: number,
  configuration: FluidTherapyConfiguration<TFluidType>,
  fluidClass: FluidProductClass,
): FluidTherapyFeatureProjection<TFluidType> {
  const deliveredVolumeMl = deliveredFluidVolumeAt(state, simulationTimeSec);
  return Object.freeze({
    featureId: state.featureId,
    administrationId: state.administrationId,
    patientId: state.patientId,
    fluidType: state.fluidType,
    fluidClass,
    mode: state.mode,
    status: state.status,
    vascularAccessId: state.vascularAccessId,
    ...(state.prescribedVolumeMl === undefined ? {} : { prescribedVolumeMl: state.prescribedVolumeMl }),
    currentRateMlHour: state.status === "RUNNING" ? state.rateMlHour : 0,
    cumulativeDeliveredVolumeMl: deliveredVolumeMl,
    effectiveIntravascularVolumeMl: effectiveIntravascularVolumeMl(deliveredVolumeMl, configuration),
    startedAtSimulationTimeSec: state.startedAtSimulationTimeSec,
    lastRateChangeAtSimulationTimeSec: state.lastRateChangeAtSimulationTimeSec,
    ...(state.stoppedAtSimulationTimeSec === undefined ? {} : { stoppedAtSimulationTimeSec: state.stoppedAtSimulationTimeSec }),
    ...(state.completedAtSimulationTimeSec === undefined ? {} : { completedAtSimulationTimeSec: state.completedAtSimulationTimeSec }),
  });
}

export class FluidTherapyRuntime<TFluidType extends string> {
  private readonly administrations = new Map<string, FluidTherapyAdministrationState<TFluidType>>();
  private readonly commandResults = new Map<string, FluidTherapyCommandResult<TFluidType>>();
  private readonly events: FluidTherapyRuntimeEvent<TFluidType>[] = [];

  constructor(private readonly configuration: FluidTherapyConfiguration<TFluidType>,
    private readonly fluidClass: FluidProductClass = "CRYSTALLOID") {
    this.assertConfiguration(configuration);
  }

  reset(): void {
    this.administrations.clear();
    this.commandResults.clear();
    this.events.length = 0;
  }

  execute(command: FluidTherapyCommand<TFluidType>, circulation?: CirculationState): FluidTherapyCommandResult<TFluidType> {
    const duplicate = this.commandResults.get(command.commandId);
    if (duplicate) return structuredClone({ ...duplicate, status: "IDEMPOTENT" as const });
    const errors = validate(command, this.configuration);
    if (!errors.length && circulation && circulation.patientId !== command.patientId) errors.push("INVALID_PATIENT");
    if (!errors.length && command.action === "START" && !this.access(command, circulation)) {
      errors.push("MISSING_VASCULAR_ACCESS");
    }
    if (errors.length) return this.reject(command, errors[0]);
    const result = command.action === "START" ? this.start(command, circulation!)
      : command.action === "CHANGE_RATE" ? this.changeRate(command) : this.stop(command);
    this.commandResults.set(command.commandId, structuredClone(result));
    return structuredClone(result);
  }

  advanceTo(simulationTimeSec: number): FluidTherapyRuntimeEvent<TFluidType>[] {
    const generated: FluidTherapyRuntimeEvent<TFluidType>[] = [];
    for (const current of this.ordered()) {
      if (current.status !== "RUNNING") continue;
      const delivered = deliveredFluidVolumeAt(current, simulationTimeSec);
      const completed = current.mode === "BOLUS" && delivered >= current.prescribedVolumeMl!;
      const completionAt = completed
        ? current.lastRateChangeAtSimulationTimeSec +
          (current.prescribedVolumeMl! - current.deliveredVolumeAtLastChangeMl) / current.rateMlHour * 3600
        : undefined;
      const next: FluidTherapyAdministrationState<TFluidType> = Object.freeze({
        ...current,
        status: completed ? "COMPLETED" : "RUNNING",
        deliveredVolumeMl: delivered,
        ...(completionAt === undefined ? {} : { completedAtSimulationTimeSec: precise(completionAt) }),
      });
      this.administrations.set(next.administrationId, next);
      if (completed) generated.push(this.event("FluidAdministrationCompleted", next, next.completedAtSimulationTimeSec));
    }
    this.events.push(...generated);
    return structuredClone(generated);
  }

  projectionsAt(simulationTimeSec: number): readonly FluidTherapyFeatureProjection<TFluidType>[] {
    return this.ordered().map(state => projectState(state, simulationTimeSec, this.configuration, this.fluidClass));
  }

  vitalContributorsAt(simulationTimeSec: number): readonly VitalSignContributor[] {
    return this.projectionsAt(simulationTimeSec).flatMap(projection =>
      fluidVolumeVitalContributors(projection, this.configuration));
  }

  snapshot(): FluidTherapyRuntimeSnapshot<TFluidType> | undefined {
    if (!this.administrations.size && !this.commandResults.size && !this.events.length) return undefined;
    return Object.freeze({
      schemaVersion: 1,
      configuration: structuredClone(this.configuration),
      administrations: this.ordered().map(item => structuredClone(item)),
      commandResults: [...this.commandResults.values()].sort((a, b) => a.commandId.localeCompare(b.commandId))
        .map(item => structuredClone(item)),
      events: structuredClone(this.events),
    });
  }

  restore(snapshot?: FluidTherapyRuntimeSnapshot<TFluidType>): void {
    this.reset();
    if (!snapshot) return;
    if (snapshot.schemaVersion !== 1 || JSON.stringify(snapshot.configuration) !== JSON.stringify(this.configuration)) {
      throw new Error("FLUID_THERAPY_CONFIGURATION_MISMATCH");
    }
    snapshot.administrations.forEach(item => this.administrations.set(item.administrationId, structuredClone(item)));
    snapshot.commandResults.forEach(item => this.commandResults.set(item.commandId, structuredClone(item)));
    this.events.push(...structuredClone(snapshot.events));
  }

  private start(command: FluidTherapyCommand<TFluidType>, circulation: CirculationState): FluidTherapyCommandResult<TFluidType> {
    if (this.administrations.has(command.administrationId)) return this.reject(command, "INVALID_STATE", false);
    const access = circulation.vascularAccess.find(item => item.interventionInstanceId === command.vascularAccessId)!;
    const state: FluidTherapyAdministrationState<TFluidType> = Object.freeze({
      schemaVersion: 1,
      featureId: this.configuration.fluidType,
      administrationId: command.administrationId,
      patientId: command.patientId,
      fluidType: this.configuration.fluidType,
      route: access.type === "IO" ? "IO" : "IV",
      vascularAccessId: access.interventionInstanceId,
      mode: command.mode!,
      status: "RUNNING",
      ...(command.mode === "BOLUS" ? { prescribedVolumeMl: command.prescribedVolumeMl } : {}),
      rateMlHour: command.rateMlHour!,
      deliveredVolumeMl: 0,
      deliveredVolumeAtLastChangeMl: 0,
      startedAtSimulationTimeSec: command.simulationTimeSec,
      lastRateChangeAtSimulationTimeSec: command.simulationTimeSec,
    });
    this.administrations.set(state.administrationId, state);
    this.events.push(this.event("FluidAdministrationStarted", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private changeRate(command: FluidTherapyCommand<TFluidType>): FluidTherapyCommandResult<TFluidType> {
    const current = this.administrations.get(command.administrationId);
    if (!current) return this.reject(command, "ADMINISTRATION_NOT_FOUND", false);
    if (current.patientId !== command.patientId || current.status !== "RUNNING") {
      return this.reject(command, "INVALID_STATE", false);
    }
    if (command.simulationTimeSec < current.lastRateChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", false);
    }
    if (current.rateMlHour === command.rateMlHour) {
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    }
    const delivered = deliveredFluidVolumeAt(current, command.simulationTimeSec);
    const state: FluidTherapyAdministrationState<TFluidType> = Object.freeze({
      ...current,
      rateMlHour: command.rateMlHour!,
      deliveredVolumeMl: delivered,
      deliveredVolumeAtLastChangeMl: delivered,
      lastRateChangeAtSimulationTimeSec: command.simulationTimeSec,
    });
    this.administrations.set(state.administrationId, state);
    this.events.push(this.event("FluidAdministrationRateChanged", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private stop(command: FluidTherapyCommand<TFluidType>): FluidTherapyCommandResult<TFluidType> {
    const current = this.administrations.get(command.administrationId);
    if (!current) return this.reject(command, "ADMINISTRATION_NOT_FOUND", false);
    if (current.patientId !== command.patientId) return this.reject(command, "INVALID_STATE", false);
    if (current.status !== "RUNNING") {
      return Object.freeze({ status: "NO_OP", commandId: command.commandId, state: structuredClone(current) });
    }
    if (command.simulationTimeSec < current.lastRateChangeAtSimulationTimeSec) {
      return this.reject(command, "STALE_SIMULATION_TIME", false);
    }
    const delivered = deliveredFluidVolumeAt(current, command.simulationTimeSec);
    const state: FluidTherapyAdministrationState<TFluidType> = Object.freeze({
      ...current,
      status: "STOPPED",
      rateMlHour: 0,
      deliveredVolumeMl: delivered,
      deliveredVolumeAtLastChangeMl: delivered,
      lastRateChangeAtSimulationTimeSec: command.simulationTimeSec,
      stoppedAtSimulationTimeSec: command.simulationTimeSec,
    });
    this.administrations.set(state.administrationId, state);
    this.events.push(this.event("FluidAdministrationStopped", state, command.simulationTimeSec, command.commandId));
    return Object.freeze({ status: "APPLIED", commandId: command.commandId, state: structuredClone(state) });
  }

  private reject(command: FluidTherapyCommand<TFluidType>, reasonCode: FluidTherapyRejectionReason,
    remember = true): FluidTherapyCommandResult<TFluidType> {
    const result: FluidTherapyCommandResult<TFluidType> = Object.freeze({
      status: "REJECTED", commandId: command.commandId, rejectionReason: reasonCode,
    });
    if (remember && command.commandId) this.commandResults.set(command.commandId, result);
    this.events.push(Object.freeze({
      eventType: "FluidAdministrationRejected",
      commandId: command.commandId,
      administrationId: command.administrationId,
      patientId: command.patientId,
      fluidType: this.configuration.fluidType,
      timestamp: command.simulationTimeSec,
      deliveredVolumeMl: 0,
      rateMlHour: Number.isFinite(command.rateMlHour) ? command.rateMlHour! : 0,
      reasonCode,
    }));
    return structuredClone(result);
  }

  private event(eventType: FluidTherapyRuntimeEvent<TFluidType>["eventType"],
    state: FluidTherapyAdministrationState<TFluidType>, timestamp: number | undefined,
    commandId?: string): FluidTherapyRuntimeEvent<TFluidType> {
    return Object.freeze({
      eventType,
      commandId,
      administrationId: state.administrationId,
      patientId: state.patientId,
      fluidType: state.fluidType,
      timestamp: timestamp ?? state.lastRateChangeAtSimulationTimeSec,
      deliveredVolumeMl: state.deliveredVolumeMl,
      rateMlHour: state.rateMlHour,
    });
  }

  private ordered(): FluidTherapyAdministrationState<TFluidType>[] {
    return [...this.administrations.values()].sort((a, b) =>
      a.startedAtSimulationTimeSec - b.startedAtSimulationTimeSec || a.administrationId.localeCompare(b.administrationId));
  }

  private access(command: FluidTherapyCommand<TFluidType>, circulation?: CirculationState): boolean {
    return Boolean(circulation?.vascularAccess.some(item => item.interventionInstanceId === command.vascularAccessId));
  }

  private assertConfiguration(configuration: FluidTherapyConfiguration<TFluidType>): void {
    const values = [configuration.effectiveIntravascularFraction, configuration.maximumPrescribedVolumeMl,
      configuration.maximumRateMlHour, ...Object.values(configuration.vitalResponsePer1000EffectiveMl)];
    if (!configuration.fluidType || !configuration.version || values.some(value => !Number.isFinite(value)) ||
      configuration.effectiveIntravascularFraction < 0 || configuration.effectiveIntravascularFraction > 1 ||
      configuration.maximumPrescribedVolumeMl <= 0 || configuration.maximumRateMlHour <= 0) {
      throw new Error("FLUID_THERAPY_CONFIGURATION_INVALID");
    }
  }
}
