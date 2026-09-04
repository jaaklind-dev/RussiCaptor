import type { CirculationState } from "@/models/CirculationState";
import {
  FLUID_RATE_UNIT,
  FLUID_VOLUME_UNIT,
  RINGER_FEATURE_ID,
  SODIUM_CHLORIDE_0_9_FEATURE_ID,
  type FluidTherapyCommand,
  type SupportedFluidTherapyCommand,
} from "@/models/FluidTherapy";
import type { GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture, pressureDependentHemorrhageFixture } from "@/services/exercise/CanonicalPatientDatasets";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { RINGER_FLUID_CONFIGURATION } from "@/services/runtime/medication/RingerFluidTherapy";
import {
  SODIUM_CHLORIDE_0_9_CONFIGURATION,
  SODIUM_CHLORIDE_0_9_PRODUCT,
  SodiumChlorideFluidTherapyRuntime,
  sodiumChlorideClinicalFeatureContract,
} from "@/services/runtime/medication/SodiumChlorideFluidTherapy";

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

const nacl = (overrides: Partial<FluidTherapyCommand<"SODIUM_CHLORIDE_0_9">> = {}):
FluidTherapyCommand<"SODIUM_CHLORIDE_0_9"> => ({
  commandId: "NACL-START",
  action: "START",
  administrationId: "NACL-1",
  patientId,
  fluidType: SODIUM_CHLORIDE_0_9_FEATURE_ID,
  simulationTimeSec: 0,
  mode: "BOLUS",
  prescribedVolumeMl: 500,
  volumeUnit: FLUID_VOLUME_UNIT,
  rateMlHour: 1000,
  rateUnit: FLUID_RATE_UNIT,
  vascularAccessId: "IV-1",
  ...overrides,
});

const ringer = (overrides: Partial<FluidTherapyCommand<"RINGER">> = {}): FluidTherapyCommand<"RINGER"> => ({
  ...nacl(),
  commandId: "RINGER-START",
  administrationId: "RINGER-1",
  fluidType: RINGER_FEATURE_ID,
  ...overrides,
});

const tick = (time: number, target = patientId, id = `NACL-TICK-${target}-${time}`): GoldenInputEvent => ({
  sequenceId: "NACL",
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
    interventionId: `PIV-NACL-${patient}`,
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

function atScenarioTime<T extends SupportedFluidTherapyCommand>(command: T, patient: string, accessId: string,
  overrides: Partial<T> = {}): T {
  return { ...command, patientId: patient, vascularAccessId: accessId, simulationTimeSec: 180, ...overrides };
}

describe("0.9% sodium chloride fluid therapy", () => {
  test("uses the unambiguous canonical identity and generic crystalloid contract", () => {
    expect(sodiumChlorideClinicalFeatureContract).toMatchObject({
      featureId: "SODIUM_CHLORIDE_0_9",
      category: "FLUID",
      schemaVersion: 1,
      configuration: { fluidType: "SODIUM_CHLORIDE_0_9" },
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
    });
    expect(SODIUM_CHLORIDE_0_9_PRODUCT).toEqual({
      fluidClass: "CRYSTALLOID",
      configuration: SODIUM_CHLORIDE_0_9_CONFIGURATION,
    });
    expect(new SodiumChlorideFluidTherapyRuntime().snapshot()).toBeUndefined();
  });

  test("reuses Ringer crystalloid parameters without altering Ringer configuration", () => {
    expect(SODIUM_CHLORIDE_0_9_CONFIGURATION).toEqual({
      ...RINGER_FLUID_CONFIGURATION,
      version: "SODIUM_CHLORIDE_0_9_VOLUME_V1",
      fluidType: "SODIUM_CHLORIDE_0_9",
    });
    expect(RINGER_FLUID_CONFIGURATION).toMatchObject({
      version: "RINGER_VOLUME_V1", fluidType: "RINGER", effectiveIntravascularFraction: 0.25,
    });
  });

  test("bolus supports partial delivery, exact completion and command idempotency", () => {
    const runtime = new SodiumChlorideFluidTherapyRuntime();
    const start = nacl();
    expect(runtime.execute(start, circulation).status).toBe("APPLIED");
    expect(runtime.execute(start, circulation).status).toBe("IDEMPOTENT");
    runtime.advanceTo(900);
    expect(runtime.projectionsAt(900)[0]).toMatchObject({
      fluidType: "SODIUM_CHLORIDE_0_9", fluidClass: "CRYSTALLOID", status: "RUNNING",
      cumulativeDeliveredVolumeMl: 250, effectiveIntravascularVolumeMl: 62.5,
    });
    runtime.advanceTo(3600);
    expect(runtime.projectionsAt(3600)[0]).toMatchObject({
      status: "COMPLETED", cumulativeDeliveredVolumeMl: 500, completedAtSimulationTimeSec: 1800,
    });
    runtime.advanceTo(7200);
    expect(runtime.projectionsAt(7200)[0].cumulativeDeliveredVolumeMl).toBe(500);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "FluidAdministrationStarted")).toHaveLength(1);
  });

  test("infusion rate change and stop preserve exact delivered-volume anchors", () => {
    const runtime = new SodiumChlorideFluidTherapyRuntime();
    runtime.execute(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.advanceTo(600);
    const change = nacl({ commandId: "NACL-CHANGE", action: "CHANGE_RATE", simulationTimeSec: 600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 });
    expect(runtime.execute(change).status).toBe("APPLIED");
    expect(runtime.execute(change).status).toBe("IDEMPOTENT");
    expect(runtime.projectionsAt(1200)[0].cumulativeDeliveredVolumeMl).toBe(300);
    const stop = nacl({ commandId: "NACL-STOP", action: "STOP", simulationTimeSec: 1200,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: undefined, rateUnit: undefined });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.execute(stop).status).toBe("IDEMPOTENT");
    runtime.advanceTo(9999);
    expect(runtime.projectionsAt(9999)[0]).toMatchObject({ status: "STOPPED", cumulativeDeliveredVolumeMl: 300 });
  });

  test("unsupported sodium chloride concentration and product identity fail closed", () => {
    const medication = new MedicationEngine();
    expect(medication.executeFluidTherapy({ ...nacl(), fluidType: "SODIUM_CHLORIDE_3" as "RINGER" }, circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FLUID_TYPE" });
    expect(new SodiumChlorideFluidTherapyRuntime().execute({
      ...nacl(), fluidType: "SODIUM_CHLORIDE" as "SODIUM_CHLORIDE_0_9",
    }, circulation)).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FLUID_TYPE" });
  });

  test.each([
    [{ prescribedVolumeMl: Number.NaN }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: Number.POSITIVE_INFINITY }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: -1 }, "INVALID_VOLUME"],
    [{ prescribedVolumeMl: 5001 }, "INVALID_VOLUME"],
    [{ rateMlHour: Number.NaN }, "INVALID_RATE"],
    [{ rateMlHour: Number.POSITIVE_INFINITY }, "INVALID_RATE"],
    [{ rateMlHour: 0 }, "INVALID_RATE"],
    [{ rateMlHour: 3001 }, "INVALID_RATE"],
    [{ rateUnit: "ML_MIN" }, "INVALID_UNIT"],
    [{ volumeUnit: "L" }, "INVALID_UNIT"],
    [{ mode: "UNSUPPORTED" as "BOLUS" }, "INVALID_MODE"],
  ])("reuses generic validation for invalid input %#", (overrides, expected) => {
    expect(new SodiumChlorideFluidTherapyRuntime().execute(nacl(overrides), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: expected });
  });

  test("reuses generic patient and IV/IO access validation", () => {
    expect(new SodiumChlorideFluidTherapyRuntime().execute(nacl({ patientId: "OTHER" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_PATIENT" });
    expect(new SodiumChlorideFluidTherapyRuntime().execute(nacl({ vascularAccessId: "UNKNOWN" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    expect(new SodiumChlorideFluidTherapyRuntime().execute(nacl({ vascularAccessId: "IO-1" }), circulation).state?.route)
      .toBe("IO");
  });

  test("Ringer and NaCl remain independent and their effective volume is additive", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(ringer({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 600 }), circulation);
    medication.executeFluidTherapy(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), circulation);
    medication.advanceTo(600);
    const projection = medication.fluidTherapyProjectionsAt(600);
    expect(projection).toEqual(expect.arrayContaining([
      expect.objectContaining({ fluidType: "RINGER", cumulativeDeliveredVolumeMl: 100 }),
      expect.objectContaining({ fluidType: "SODIUM_CHLORIDE_0_9", cumulativeDeliveredVolumeMl: 200 }),
    ]));
    expect(projection.reduce((sum, item) => sum + item.effectiveIntravascularVolumeMl, 0)).toBe(75);
    expect(medication.vitalContributorsAt(600).filter(item => item.layer === "VOLUME_RESUSCITATION" &&
      item.vital === "systolicBp").reduce((sum, item) => sum + item.value, 0)).toBe(2.625);
  });

  test("mixed-fluid state and physiology are command-order independent", () => {
    const first = new MedicationEngine();
    const second = new MedicationEngine();
    first.executeFluidTherapy(ringer({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 600 }), circulation);
    first.executeFluidTherapy(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), circulation);
    second.executeFluidTherapy(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), circulation);
    second.executeFluidTherapy(ringer({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 600 }), circulation);
    first.advanceTo(600); second.advanceTo(600);
    expect(first.fluidTherapyProjectionsAt(600)).toEqual(second.fluidTherapyProjectionsAt(600));
    expect(first.vitalContributorsAt(600)).toEqual(second.vitalContributorsAt(600));
  });

  test("mixed Ringer and NaCl checkpoint restores both products independently", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(ringer({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 600 }), circulation);
    medication.executeFluidTherapy(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), circulation);
    medication.advanceTo(600);
    const snapshot = medication.snapshot();
    expect(snapshot.fluidTherapy?.additionalProducts).toHaveLength(1);
    const restored = new MedicationEngine();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.fluidTherapyProjectionsAt(600)).toEqual(medication.fluidTherapyProjectionsAt(600));
    expect(restored.vitalContributorsAt(600)).toEqual(medication.vitalContributorsAt(600));
  });

  test("NaCl-only bolus, infusion, rate-change and stop state round-trip", () => {
    const runtime = new SodiumChlorideFluidTherapyRuntime();
    runtime.execute(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.execute(nacl({ commandId: "NACL-CHANGE", action: "CHANGE_RATE", simulationTimeSec: 600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 }), circulation);
    runtime.execute(nacl({ commandId: "NACL-STOP", action: "STOP", simulationTimeSec: 900,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: undefined, rateUnit: undefined }), circulation);
    const snapshot = runtime.snapshot()!;
    const restored = new SodiumChlorideFluidTherapyRuntime();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(9999)).toEqual(runtime.projectionsAt(9999));

    const bolus = new SodiumChlorideFluidTherapyRuntime();
    bolus.execute(nacl(), circulation); bolus.advanceTo(900);
    const partial = bolus.snapshot()!;
    const partialRestart = new SodiumChlorideFluidTherapyRuntime(); partialRestart.restore(partial);
    expect(partialRestart.projectionsAt(900)).toEqual(bolus.projectionsAt(900));
    partialRestart.advanceTo(3600);
    const completed = partialRestart.snapshot()!;
    const completedRestart = new SodiumChlorideFluidTherapyRuntime(); completedRestart.restore(completed);
    expect(completedRestart.projectionsAt(7200)[0]).toMatchObject({
      status: "COMPLETED", cumulativeDeliveredVolumeMl: 500,
    });
  });

  test("Scenario checkpoint preserves NaCl, Ringer, norepinephrine and derived hemodynamics", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(ringer({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 600 }), patient, accessId));
    engine.executeFluidTherapyCommand(atScenarioTime(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), patient, accessId));
    engine.executeNorepinephrineCommand({ commandId: "NE", action: "START", infusionId: "NE-1", patientId: patient,
      simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: accessId });
    engine.advanceTo(600); engine.dispatch(tick(600, patient));
    const payload = engine.captureRuntimePayload();
    const before = engine.getRuntimeState();
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getFluidTherapyState()).toEqual(engine.getFluidTherapyState());
    expect(restored.getNorepinephrineState()).toEqual(engine.getNorepinephrineState());
    expect(restored.getRuntimeState().vitalSignState).toEqual(before.vitalSignState);
  });

  test("assessment and debug projections distinguish NaCl from Ringer", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(ringer(), patient, accessId));
    engine.executeFluidTherapyCommand(atScenarioTime(nacl(), patient, accessId));
    engine.advanceTo(1080); engine.dispatch(tick(1080, patient));
    const assessment = engine.getAssessmentSnapshot().clinicalFeatures ?? [];
    expect(assessment).toContainEqual(expect.objectContaining({
      featureId: "RINGER", fluidType: "RINGER", fluidClass: "CRYSTALLOID",
    }));
    expect(assessment).toContainEqual(expect.objectContaining({
      featureId: "SODIUM_CHLORIDE_0_9", fluidType: "SODIUM_CHLORIDE_0_9", fluidClass: "CRYSTALLOID",
    }));
    const debug = getPatientResourceDebugSnapshot(patient).medicationState?.clinicalFeatures ?? [];
    expect(debug.map(item => item.featureId)).toEqual(expect.arrayContaining(["RINGER", "SODIUM_CHLORIDE_0_9"]));
  });

  test("NaCl and norepinephrine retain distinct volume and vasopressor contributors", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1200 }), patient, accessId));
    engine.executeNorepinephrineCommand({ commandId: "NE", action: "START", infusionId: "NE-1", patientId: patient,
      simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: accessId });
    engine.advanceTo(300); engine.dispatch(tick(300, patient));
    const contributors = engine.getRuntimeState().vitalSignState!.activeContributors;
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "VOLUME_RESUSCITATION", sourceId: "NACL-1" }));
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "MEDICATION", sourceId: "NE-1" }));
  });

  test("no-NaCl baseline leaves Ringer checkpoint representation unchanged", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(ringer(), circulation);
    const snapshot = medication.snapshot();
    expect(snapshot.fluidTherapy).not.toHaveProperty("additionalProducts");
    expect(snapshot.fluidTherapy?.configuration).toEqual(RINGER_FLUID_CONFIGURATION);
    expect(snapshot.fluidTherapy?.administrations).toHaveLength(1);
    expect(snapshot).not.toHaveProperty("nacl");
  });

  test("pelvic hemorrhage conserves blood loss and has no NaCl source-control shortcut", () => {
    const treated = engineWithAccess(pressureDependentHemorrhageFixture);
    const control = engineWithAccess(pressureDependentHemorrhageFixture).engine;
    treated.engine.executeFluidTherapyCommand(atScenarioTime(nacl({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 3000 }), treated.patient, treated.accessId));
    for (const time of [240, 300, 360, 420, 480, 540, 600]) {
      treated.engine.advanceTo(time); treated.engine.dispatch(tick(time, treated.patient, `NACL-${time}`));
      control.advanceTo(time); control.dispatch(tick(time, treated.patient, `CONTROL-${time}`));
    }
    const treatedHemorrhage = treated.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    const controlHemorrhage = control.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    expect(treated.engine.getRuntimeState().displayedVitals.sbp).toBeGreaterThan(control.getRuntimeState().displayedVitals.sbp!);
    expect(treatedHemorrhage.configuration).toEqual(controlHemorrhage.configuration);
    expect(treatedHemorrhage.clinicalState.cumulativeLossMl).toBeGreaterThanOrEqual(
      controlHemorrhage.clinicalState.cumulativeLossMl,
    );
    expect(treatedHemorrhage.clinicalState.activeEffects.some(effect =>
      ["REDUCE_EXTERNAL_BLEEDING", "STOP_EXTERNAL_BLEEDING", "PELVIC_STABILIZATION"].includes(effect.effectType)))
      .toBe(false);
  });
});
