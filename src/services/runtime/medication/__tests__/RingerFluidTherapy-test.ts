import type { CirculationState } from "@/models/CirculationState";
import {
  FLUID_RATE_UNIT,
  FLUID_VOLUME_UNIT,
  RINGER_FEATURE_ID,
  type FluidTherapyCommand,
  type FluidTherapyConfiguration,
} from "@/models/FluidTherapy";
import type { GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture, pressureDependentHemorrhageFixture } from "@/services/exercise/CanonicalPatientDatasets";
import {
  FluidTherapyRuntime,
  createFluidTherapyContract,
  deliveredFluidVolumeAt,
  effectiveIntravascularVolumeMl,
} from "@/services/runtime/medication/FluidTherapyRuntime";
import {
  RINGER_FLUID_CONFIGURATION,
  RingerFluidTherapyRuntime,
  ringerClinicalFeatureContract,
} from "@/services/runtime/medication/RingerFluidTherapy";

const patientId = "PT-PELVIC-001";
const circulation: CirculationState = {
  patientId,
  vascularAccess: [
    { interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["PIV-1"], establishedAt: 0 },
    { interventionInstanceId: "IO-1", type: "IO", resourceIds: ["IO-1"], establishedAt: 0 },
  ],
  hemorrhageControl: [],
  runningInfusions: [],
  updatedAt: 0,
};

const command = (overrides: Partial<FluidTherapyCommand<"RINGER">> = {}): FluidTherapyCommand<"RINGER"> => ({
  commandId: "FLUID-START",
  action: "START",
  administrationId: "RINGER-1",
  patientId,
  fluidType: RINGER_FEATURE_ID,
  simulationTimeSec: 0,
  mode: "BOLUS",
  prescribedVolumeMl: 500,
  volumeUnit: FLUID_VOLUME_UNIT,
  rateMlHour: 1000,
  rateUnit: FLUID_RATE_UNIT,
  vascularAccessId: "IV-1",
  ...overrides,
});

const tick = (time: number, target = patientId, id = `TICK-${target}-${time}`): GoldenInputEvent => ({
  sequenceId: "RINGER",
  step: time,
  offsetSec: time,
  eventType: "ENGINE_TICK",
  actor: "ENGINE",
  target,
  eventId: id,
  result: "SUCCESS",
  payload: { tickMin: 1 },
});

function engineWithAccess(fixture = mtpReferenceFixture): { engine: ClinicalScenarioEngine; accessId: string; patient: string } {
  const patient = fixture.patientId!;
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.scheduleIntervention({
    interventionId: `PIV-RINGER-${patient}`,
    patientId: patient,
    resourceId: "PIV-1",
    action: "APPLY",
    timestamp: 0,
    definitionId: "PERIPHERAL_IV_ACCESS",
    parameters: { location: "arm", gauge: 18, attempts: 1 },
  });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
  engine.advanceTo(180);
  engine.dispatch(tick(180, patient));
  return { engine, accessId: engine.getCirculationState(patient).vascularAccess[0].interventionInstanceId, patient };
}

function scenarioCommand(patient: string, accessId: string,
  overrides: Partial<FluidTherapyCommand<"RINGER">> = {}): FluidTherapyCommand<"RINGER"> {
  return command({ patientId: patient, vascularAccessId: accessId, simulationTimeSec: 180, ...overrides });
}

describe("Ringer fluid therapy", () => {
  test("reuses the Clinical Feature Contract with the volume-resuscitation order", () => {
    expect(ringerClinicalFeatureContract).toMatchObject({
      featureId: "RINGER",
      category: "FLUID",
      schemaVersion: 1,
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      persistence: { boundary: "RUNTIME_CHECKPOINT", detached: true },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
    });
    expect(ringerClinicalFeatureContract.physiology.order).toEqual([
      "UNDERLYING_PHYSIOLOGY", "HEMORRHAGE_SOURCE_CONTROL", "VOLUME_RESUSCITATION",
      "VASOPRESSOR", "FINAL_HEMODYNAMICS",
    ]);
  });

  test("generic fluid runtime can be configured for another product identity without a second lifecycle", () => {
    const referenceConfiguration: FluidTherapyConfiguration<"REFERENCE_CRYSTALLOID"> = {
      ...RINGER_FLUID_CONFIGURATION,
      fluidType: "REFERENCE_CRYSTALLOID",
      version: "REFERENCE_ONLY_V1",
    };
    const runtime = new FluidTherapyRuntime(referenceConfiguration);
    const contract = createFluidTherapyContract(referenceConfiguration);
    expect(contract.featureId).toBe("REFERENCE_CRYSTALLOID");
    expect(runtime.snapshot()).toBeUndefined();
  });

  test("bolus starts once, delivers exact partial mL and completes without over-delivery", () => {
    const runtime = new RingerFluidTherapyRuntime();
    const start = command();
    expect(runtime.execute(start, circulation).status).toBe("APPLIED");
    expect(runtime.execute(start, circulation).status).toBe("IDEMPOTENT");
    runtime.advanceTo(900);
    expect(runtime.projectionsAt(900)[0]).toMatchObject({ status: "RUNNING", cumulativeDeliveredVolumeMl: 250 });
    const events = runtime.advanceTo(3600);
    expect(runtime.projectionsAt(3600)[0]).toMatchObject({
      status: "COMPLETED", cumulativeDeliveredVolumeMl: 500, currentRateMlHour: 0,
      completedAtSimulationTimeSec: 1800,
    });
    expect(events).toContainEqual(expect.objectContaining({ eventType: "FluidAdministrationCompleted", timestamp: 1800 }));
    runtime.advanceTo(7200);
    expect(runtime.projectionsAt(7200)[0].cumulativeDeliveredVolumeMl).toBe(500);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "FluidAdministrationStarted")).toHaveLength(1);
  });

  test("controlled infusion changes rate without double-counting delivered volume", () => {
    const runtime = new RingerFluidTherapyRuntime();
    runtime.execute(command({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.advanceTo(600);
    expect(runtime.projectionsAt(600)[0].cumulativeDeliveredVolumeMl).toBe(100);
    const change = command({ commandId: "RATE-CHANGE", action: "CHANGE_RATE", simulationTimeSec: 600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 });
    expect(runtime.execute(change).status).toBe("APPLIED");
    expect(runtime.execute(change).status).toBe("IDEMPOTENT");
    runtime.advanceTo(1200);
    expect(runtime.projectionsAt(1200)[0]).toMatchObject({ cumulativeDeliveredVolumeMl: 300, currentRateMlHour: 1200 });
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "FluidAdministrationRateChanged")).toHaveLength(1);
  });

  test("stop freezes delivered volume and repeated stop is safe", () => {
    const runtime = new RingerFluidTherapyRuntime();
    runtime.execute(command({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    const stop = command({ commandId: "STOP", action: "STOP", simulationTimeSec: 600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: undefined,
      rateUnit: undefined, vascularAccessId: undefined });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.execute(stop).status).toBe("IDEMPOTENT");
    runtime.advanceTo(9999);
    expect(runtime.projectionsAt(9999)[0]).toMatchObject({
      status: "STOPPED", cumulativeDeliveredVolumeMl: 100, currentRateMlHour: 0,
      stoppedAtSimulationTimeSec: 600,
    });
    expect(runtime.execute({ ...stop, commandId: "STOP-2", simulationTimeSec: 9999 }).status).toBe("NO_OP");
  });

  test.each([
    [{ prescribedVolumeMl: Number.NaN }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: Number.POSITIVE_INFINITY }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: -1 }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: 5001 }, "INVALID_VOLUME"],
    [{ rateMlHour: Number.NaN }, "INVALID_RATE"],
    [{ rateMlHour: Number.POSITIVE_INFINITY }, "INVALID_RATE"],
    [{ rateMlHour: -1 }, "INVALID_RATE"],
    [{ rateMlHour: 0 }, "INVALID_RATE"],
    [{ rateMlHour: 3001 }, "INVALID_RATE"],
    [{ rateUnit: "ML_MIN" }, "INVALID_UNIT"],
    [{ volumeUnit: "L" }, "INVALID_UNIT"],
    [{ mode: "UNSUPPORTED" as "BOLUS" }, "INVALID_MODE"],
    [{ action: "UNSUPPORTED" as "START" }, "INVALID_COMMAND"],
  ])("rejects invalid configured input %#", (overrides, expected) => {
    expect(new RingerFluidTherapyRuntime().execute(command(overrides), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: expected });
  });

  test("fails closed for wrong patient, fluid identity and vascular access", () => {
    const runtime = new RingerFluidTherapyRuntime();
    expect(runtime.execute(command({ patientId: "UNKNOWN" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_PATIENT" });
    expect(new RingerFluidTherapyRuntime().execute(command({ fluidType: "OTHER" as "RINGER" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FLUID_TYPE" });
    expect(new RingerFluidTherapyRuntime().execute(command({ vascularAccessId: "MISSING" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    expect(new RingerFluidTherapyRuntime().execute(command({ vascularAccessId: "IO-1" }), circulation).state?.route).toBe("IO");
  });

  test("analytic delivery and effective fraction are deterministic", () => {
    const runtime = new RingerFluidTherapyRuntime();
    const state = runtime.execute(command({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1234.5 }), circulation).state!;
    expect(deliveredFluidVolumeAt(state, 123)).toBe(42.17875);
    expect(deliveredFluidVolumeAt(state, 123)).toBe(deliveredFluidVolumeAt(structuredClone(state), 123));
    expect(effectiveIntravascularVolumeMl(1000, RINGER_FLUID_CONFIGURATION)).toBe(250);
  });

  test("direct runtime snapshot round-trips infusion, rate change and stopped state", () => {
    const runtime = new RingerFluidTherapyRuntime();
    runtime.execute(command({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.execute(command({ commandId: "CHANGE", action: "CHANGE_RATE", simulationTimeSec: 600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 }), circulation);
    runtime.execute(command({ commandId: "STOP", action: "STOP", simulationTimeSec: 900,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: undefined,
      rateUnit: undefined, vascularAccessId: undefined }), circulation);
    const snapshot = runtime.snapshot()!;
    const restored = new RingerFluidTherapyRuntime();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(9999)).toEqual(runtime.projectionsAt(9999));
  });

  test("partial and completed bolus checkpoints rehydrate exactly", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(scenarioCommand(patient, accessId));
    engine.advanceTo(1080);
    engine.dispatch(tick(1080, patient));
    const partialPayload = engine.captureRuntimePayload();
    const partialRestart = new ClinicalScenarioEngine();
    partialRestart.rehydrateRuntimePayload(partialPayload);
    expect(partialRestart.captureRuntimePayload()).toEqual(partialPayload);
    expect(partialRestart.getFluidTherapyState()[0].cumulativeDeliveredVolumeMl).toBe(250);
    partialRestart.advanceTo(1980);
    partialRestart.dispatch(tick(1980, patient));
    expect(partialRestart.getFluidTherapyState()[0]).toMatchObject({
      status: "COMPLETED", cumulativeDeliveredVolumeMl: 500,
    });
    const completedPayload = partialRestart.captureRuntimePayload();
    const completedRestart = new ClinicalScenarioEngine();
    completedRestart.rehydrateRuntimePayload(completedPayload);
    expect(completedRestart.captureRuntimePayload()).toEqual(completedPayload);
    expect(completedRestart.getFluidTherapyState()).toEqual(partialRestart.getFluidTherapyState());
  });

  test("ScenarioEngine infusion/rate-change/stop checkpoints remain deterministic", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(scenarioCommand(patient, accessId, {
      mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 600,
    }));
    engine.advanceTo(780); engine.dispatch(tick(780, patient));
    engine.executeFluidTherapyCommand(scenarioCommand(patient, accessId, {
      commandId: "CHANGE", action: "CHANGE_RATE", simulationTimeSec: 780, mode: undefined,
      prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined, rateMlHour: 1200,
    }));
    const changedPayload = engine.captureRuntimePayload();
    const changedRestart = new ClinicalScenarioEngine();
    changedRestart.rehydrateRuntimePayload(changedPayload);
    expect(changedRestart.captureRuntimePayload()).toEqual(changedPayload);
    changedRestart.advanceTo(1080); changedRestart.dispatch(tick(1080, patient));
    changedRestart.executeFluidTherapyCommand(scenarioCommand(patient, accessId, {
      commandId: "STOP", action: "STOP", simulationTimeSec: 1080, mode: undefined,
      prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: undefined,
      rateUnit: undefined, vascularAccessId: undefined,
    }));
    const stoppedPayload = changedRestart.captureRuntimePayload();
    const stoppedRestart = new ClinicalScenarioEngine();
    stoppedRestart.rehydrateRuntimePayload(stoppedPayload);
    expect(stoppedRestart.captureRuntimePayload()).toEqual(stoppedPayload);
    expect(stoppedRestart.getFluidTherapyState()).toEqual(changedRestart.getFluidTherapyState());
  });

  test("assessment and debug snapshots expose detached Ringer state", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(scenarioCommand(patient, accessId));
    engine.advanceTo(1080); engine.dispatch(tick(1080, patient));
    expect(engine.getAssessmentSnapshot().clinicalFeatures).toContainEqual(expect.objectContaining({
      featureId: "RINGER", fluidType: "RINGER", cumulativeDeliveredVolumeMl: 250,
      effectiveIntravascularVolumeMl: 62.5,
    }));
    expect(getPatientResourceDebugSnapshot(patient).medicationState?.clinicalFeatures)
      .toContainEqual(expect.objectContaining({ featureId: "RINGER", currentRateMlHour: 1000 }));
    const detached = engine.getFluidTherapyState().map(item => ({ ...item }));
    detached[0].cumulativeDeliveredVolumeMl = 999;
    expect(engine.getFluidTherapyState()[0].cumulativeDeliveredVolumeMl).toBe(250);
  });

  test("no-Ringer baseline and accepted norepinephrine behavior remain unchanged", () => {
    const first = engineWithAccess().engine;
    const second = engineWithAccess().engine;
    expect(first.captureRuntimePayload()).toEqual(second.captureRuntimePayload());
    expect(first.captureRuntimePayload().medication).not.toHaveProperty("fluidTherapy");
    const accessId = first.getCirculationState(patientId).vascularAccess[0].interventionInstanceId;
    expect(first.executeNorepinephrineCommand({ commandId: "NE", action: "START", infusionId: "NE-1",
      patientId, simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.1, unit: "MCG_KG_MIN",
      vascularAccessId: accessId }).status).toBe("APPLIED");
    expect(first.getNorepinephrineState()[0]).toMatchObject({ doseMicrogramsPerKgMin: 0.1, status: "RUNNING" });
  });

  test("Ringer and norepinephrine combine deterministically independent of command order", () => {
    const firstSetup = engineWithAccess();
    const secondSetup = engineWithAccess();
    const ne = (accessId: string) => ({ commandId: "NE", action: "START" as const, infusionId: "NE-1",
      patientId, simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: accessId });
    firstSetup.engine.executeFluidTherapyCommand(scenarioCommand(patientId, firstSetup.accessId, {
      mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 1200,
    }));
    firstSetup.engine.executeNorepinephrineCommand(ne(firstSetup.accessId));
    secondSetup.engine.executeNorepinephrineCommand(ne(secondSetup.accessId));
    secondSetup.engine.executeFluidTherapyCommand(scenarioCommand(patientId, secondSetup.accessId, {
      mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 1200,
    }));
    firstSetup.engine.advanceTo(300); firstSetup.engine.dispatch(tick(300, patientId, "COMBINED"));
    secondSetup.engine.advanceTo(300); secondSetup.engine.dispatch(tick(300, patientId, "COMBINED"));
    expect(firstSetup.engine.getRuntimeState().vitalSignState).toEqual(secondSetup.engine.getRuntimeState().vitalSignState);
    expect(firstSetup.engine.getFluidTherapyState()).toEqual(secondSetup.engine.getFluidTherapyState());
    expect(firstSetup.engine.getNorepinephrineState()).toEqual(secondSetup.engine.getNorepinephrineState());
  });

  test("pelvic bleeding remains conserved and responds only to resulting SBP", () => {
    const treatedSetup = engineWithAccess(pressureDependentHemorrhageFixture);
    const controlSetup = engineWithAccess(pressureDependentHemorrhageFixture);
    const control = controlSetup.engine;
    treatedSetup.engine.executeFluidTherapyCommand(scenarioCommand(treatedSetup.patient, treatedSetup.accessId, {
      mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 3000,
    }));
    for (const time of [240, 300, 360, 420, 480, 540, 600]) {
      treatedSetup.engine.advanceTo(time); treatedSetup.engine.dispatch(tick(time, treatedSetup.patient));
      control.advanceTo(time); control.dispatch(tick(time, treatedSetup.patient));
    }
    const treatedHemorrhage = treatedSetup.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    const controlHemorrhage = control.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    expect(treatedSetup.engine.getRuntimeState().displayedVitals.sbp).toBeGreaterThan(
      control.getRuntimeState().displayedVitals.sbp!,
    );
    expect(treatedHemorrhage.configuration).toEqual(controlHemorrhage.configuration);
    expect(treatedHemorrhage.clinicalState.cumulativeLossMl).toBeGreaterThan(0);
    expect(treatedHemorrhage.clinicalState.cumulativeLossMl).toBeGreaterThanOrEqual(
      controlHemorrhage.clinicalState.cumulativeLossMl,
    );
    expect(treatedHemorrhage.clinicalState.activeEffects.some(effect =>
      effect.effectType === "REDUCE_EXTERNAL_BLEEDING" || effect.effectType === "STOP_EXTERNAL_BLEEDING")).toBe(false);
  });
});
