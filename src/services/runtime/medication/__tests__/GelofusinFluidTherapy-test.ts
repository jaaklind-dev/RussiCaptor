import type { CirculationState } from "@/models/CirculationState";
import {
  FLUID_RATE_UNIT,
  FLUID_VOLUME_UNIT,
  GELOFUSIN_FEATURE_ID,
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
import {
  GELOFUSIN_EFFECTIVE_VOLUME_HALF_LIFE_SEC,
  GELOFUSIN_FLUID_CONFIGURATION,
  GELOFUSIN_FLUID_PRODUCT,
  GelofusinFluidTherapyRuntime,
  gelofusinClinicalFeatureContract,
} from "@/services/runtime/medication/GelofusinFluidTherapy";
import { FluidTherapyRuntime } from "@/services/runtime/medication/FluidTherapyRuntime";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { RINGER_FLUID_CONFIGURATION, ringerClinicalFeatureContract } from "@/services/runtime/medication/RingerFluidTherapy";

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

const gelofusin = (overrides: Partial<FluidTherapyCommand<"GELOFUSIN">> = {}):
FluidTherapyCommand<"GELOFUSIN"> => ({
  commandId: "GELO-START",
  action: "START",
  administrationId: "GELO-1",
  patientId,
  fluidType: GELOFUSIN_FEATURE_ID,
  simulationTimeSec: 0,
  mode: "BOLUS",
  prescribedVolumeMl: 1000,
  volumeUnit: FLUID_VOLUME_UNIT,
  rateMlHour: 3000,
  rateUnit: FLUID_RATE_UNIT,
  vascularAccessId: "IV-1",
  ...overrides,
});

const fluid = (fluidType: "RINGER" | "SODIUM_CHLORIDE_0_9", administrationId: string,
  rateMlHour = 1000): SupportedFluidTherapyCommand => ({
  commandId: `START-${administrationId}`,
  action: "START",
  administrationId,
  patientId,
  fluidType: fluidType === "RINGER" ? RINGER_FEATURE_ID : SODIUM_CHLORIDE_0_9_FEATURE_ID,
  simulationTimeSec: 0,
  mode: "INFUSION",
  rateMlHour,
  rateUnit: FLUID_RATE_UNIT,
  vascularAccessId: "IV-1",
});

const lambda = Math.LN2 / GELOFUSIN_EFFECTIVE_VOLUME_HALF_LIFE_SEC;
const constantInfusionEffect = (rateMlHour: number, durationSec: number, initialMl = 0): number =>
  initialMl * Math.exp(-lambda * durationSec) + rateMlHour / 3600 / lambda * (1 - Math.exp(-lambda * durationSec));

const tick = (time: number, target = patientId, id = `GELO-TICK-${target}-${time}`): GoldenInputEvent => ({
  sequenceId: "GELOFUSIN",
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
    interventionId: `PIV-GELO-${patient}`,
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

describe("Gelofusin colloid fluid therapy", () => {
  test("uses canonical GELOFUSIN identity and COLLOID product class", () => {
    expect(GELOFUSIN_FLUID_PRODUCT).toEqual({
      fluidClass: "COLLOID",
      configuration: GELOFUSIN_FLUID_CONFIGURATION,
    });
    expect(gelofusinClinicalFeatureContract).toMatchObject({
      featureId: "GELOFUSIN",
      category: "FLUID",
      configuration: { fluidType: "GELOFUSIN" },
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
    });
  });

  test("defines explicit configuration-driven expansion, persistence and technical limits", () => {
    expect(GELOFUSIN_FLUID_CONFIGURATION).toEqual({
      ...RINGER_FLUID_CONFIGURATION,
      version: "GELOFUSIN_VOLUME_V1",
      fluidType: "GELOFUSIN",
      effectiveIntravascularFraction: 1,
      effectiveVolumePersistence: { model: "EXPONENTIAL_DECAY", halfLifeSec: 7200 },
    });
    expect(ringerClinicalFeatureContract.authoritativeState.persistedFields)
      .not.toContain("effectiveVolumeAnchorMl");
    expect(gelofusinClinicalFeatureContract.authoritativeState.persistedFields)
      .toEqual(expect.arrayContaining(["effectiveVolumeAnchorMl", "effectiveVolumeAnchorAtSimulationTimeSec"]));
  });

  test("rejects invalid colloid persistence configuration", () => {
    expect(() => new FluidTherapyRuntime({
      ...GELOFUSIN_FLUID_CONFIGURATION,
      effectiveVolumePersistence: { model: "EXPONENTIAL_DECAY", halfLifeSec: 0 },
    }, "COLLOID")).toThrow("FLUID_THERAPY_CONFIGURATION_INVALID");
  });

  test("bolus delivery is partial, bounded and completes exactly once", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    const start = gelofusin();
    expect(runtime.execute(start, circulation).status).toBe("APPLIED");
    expect(runtime.execute(start, circulation).status).toBe("IDEMPOTENT");
    runtime.advanceTo(600);
    expect(runtime.projectionsAt(600)[0]).toMatchObject({
      fluidType: "GELOFUSIN", fluidClass: "COLLOID", status: "RUNNING", cumulativeDeliveredVolumeMl: 500,
    });
    runtime.advanceTo(1200);
    expect(runtime.projectionsAt(1200)[0]).toMatchObject({
      status: "COMPLETED", cumulativeDeliveredVolumeMl: 1000, completedAtSimulationTimeSec: 1200,
    });
    runtime.advanceTo(99_999);
    expect(runtime.projectionsAt(99_999)[0].cumulativeDeliveredVolumeMl).toBe(1000);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "FluidAdministrationCompleted")).toHaveLength(1);
  });

  test("infusion rate change and stop remain idempotent and preserve delivery anchors", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    const change = gelofusin({ commandId: "GELO-CHANGE", action: "CHANGE_RATE", simulationTimeSec: 1800,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 });
    expect(runtime.execute(change).status).toBe("APPLIED");
    expect(runtime.execute(change).status).toBe("IDEMPOTENT");
    expect(runtime.projectionsAt(3600)[0].cumulativeDeliveredVolumeMl).toBe(900);
    const stop = gelofusin({ commandId: "GELO-STOP", action: "STOP", simulationTimeSec: 3600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: undefined, rateUnit: undefined });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.execute(stop).status).toBe("IDEMPOTENT");
    expect(runtime.projectionsAt(7200)[0].cumulativeDeliveredVolumeMl).toBe(900);
  });

  test("supports generic IV and IO access and rejects invalid patient/access", () => {
    expect(new GelofusinFluidTherapyRuntime().execute(gelofusin({ vascularAccessId: "IO-1" }), circulation).state?.route)
      .toBe("IO");
    expect(new GelofusinFluidTherapyRuntime().execute(gelofusin({ patientId: "OTHER" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_PATIENT" });
    expect(new GelofusinFluidTherapyRuntime().execute(gelofusin({ vascularAccessId: "UNKNOWN" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
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
  ])("reuses generic fail-closed input validation %#", (overrides, expected) => {
    expect(new GelofusinFluidTherapyRuntime().execute(gelofusin(overrides), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: expected });
  });

  test("unsupported colloid product identity is rejected", () => {
    expect(new MedicationEngine().executeFluidTherapy({
      ...gelofusin(), fluidType: "OTHER_GELATIN" as "RINGER",
    }, circulation)).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FLUID_TYPE" });
  });

  test("completed bolus residual effect follows analytic decay reference points", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin(), circulation);
    runtime.advanceTo(1200);
    const atCompletion = runtime.projectionsAt(1200)[0].effectiveIntravascularVolumeMl;
    expect(atCompletion).toBeCloseTo(constantInfusionEffect(3000, 1200), 5);
    expect(runtime.projectionsAt(1200 + 3600)[0].effectiveIntravascularVolumeMl)
      .toBeCloseTo(atCompletion * Math.pow(0.5, 0.5), 5);
    expect(runtime.projectionsAt(1200 + 7200)[0].effectiveIntravascularVolumeMl).toBeCloseTo(atCompletion * 0.5, 5);
    expect(runtime.projectionsAt(1200 + 14_400)[0].effectiveIntravascularVolumeMl).toBeCloseTo(atCompletion * 0.25, 5);
    expect(runtime.projectionsAt(1200 + 72_000)[0].effectiveIntravascularVolumeMl)
      .toBeCloseTo(atCompletion / 1024, 5);
  });

  test("constant infusion integrates simultaneous delivery and decay analytically", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 1000 }), circulation);
    const projection = runtime.projectionsAt(3600)[0];
    expect(projection.cumulativeDeliveredVolumeMl).toBe(1000);
    expect(projection.effectiveIntravascularVolumeMl).toBeCloseTo(constantInfusionEffect(1000, 3600), 5);
    expect(projection.effectiveIntravascularVolumeMl).toBeLessThan(projection.cumulativeDeliveredVolumeMl);
  });

  test("rate-change effect is the analytic sum of both delivery intervals", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.execute(gelofusin({ commandId: "GELO-RATE", action: "CHANGE_RATE", simulationTimeSec: 3600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 }), circulation);
    const firstInterval = constantInfusionEffect(600, 3600);
    const expected = constantInfusionEffect(1200, 3600, firstInterval);
    expect(runtime.projectionsAt(7200)[0].effectiveIntravascularVolumeMl).toBeCloseTo(expected, 5);
  });

  test("stop halts delivery while residual effective volume continues decaying", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 1000 }), circulation);
    runtime.execute(gelofusin({ commandId: "GELO-STOP", action: "STOP", simulationTimeSec: 3600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: undefined, rateUnit: undefined }), circulation);
    const stopped = runtime.projectionsAt(3600)[0];
    const later = runtime.projectionsAt(10_800)[0];
    expect(later.cumulativeDeliveredVolumeMl).toBe(stopped.cumulativeDeliveredVolumeMl);
    expect(later.effectiveIntravascularVolumeMl).toBeCloseTo(stopped.effectiveIntravascularVolumeMl * 0.5, 5);
  });

  test("Gelofusin uses exactly one decaying effective-volume calculation", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 1000 }), circulation);
    const projection = runtime.projectionsAt(3600)[0];
    const systolic = runtime.vitalContributorsAt(3600).find(item => item.vital === "systolicBp")!;
    expect(systolic.value).toBeCloseTo(projection.effectiveIntravascularVolumeMl / 1000 * 35, 5);
    expect(systolic.value).not.toBeCloseTo((projection.effectiveIntravascularVolumeMl + 1000) / 1000 * 35, 2);
  });

  test("Ringer, NaCl and Gelofusin remain separate and additive", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(fluid("RINGER", "RINGER-1"), circulation);
    medication.executeFluidTherapy(fluid("SODIUM_CHLORIDE_0_9", "NACL-1"), circulation);
    medication.executeFluidTherapy(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1000 }), circulation);
    const projections = medication.fluidTherapyProjectionsAt(3600);
    expect(projections.map(item => item.fluidType)).toEqual(expect.arrayContaining([
      "RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN",
    ]));
    expect(new Set(projections.map(item => item.administrationId)).size).toBe(3);
    const expected = 250 + 250 + constantInfusionEffect(1000, 3600);
    expect(projections.reduce((sum, item) => sum + item.effectiveIntravascularVolumeMl, 0)).toBeCloseTo(expected, 5);
  });

  test.each([
    [["RINGER", "GELOFUSIN"]],
    [["SODIUM_CHLORIDE_0_9", "GELOFUSIN"]],
    [["RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN"]],
  ] as const)("mixed product order is deterministic for %j", products => {
    const build = (ordered: readonly string[]): MedicationEngine => {
      const medication = new MedicationEngine();
      for (const product of ordered) {
        medication.executeFluidTherapy(product === "GELOFUSIN"
          ? gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 1000 })
          : fluid(product as "RINGER" | "SODIUM_CHLORIDE_0_9", product === "RINGER" ? "RINGER-1" : "NACL-1"),
        circulation);
      }
      return medication;
    };
    const forward = build(products);
    const reverse = build([...products].reverse());
    expect(forward.fluidTherapyProjectionsAt(3600)).toEqual(reverse.fluidTherapyProjectionsAt(3600));
    expect(forward.vitalContributorsAt(3600)).toEqual(reverse.vitalContributorsAt(3600));
  });

  test("partial bolus checkpoint round-trip preserves delivered and effective volume", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin(), circulation); runtime.advanceTo(600);
    const restored = new GelofusinFluidTherapyRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(600)).toEqual(runtime.projectionsAt(600));
  });

  test("completed bolus checkpoint retains deterministic long residual decay", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin(), circulation); runtime.advanceTo(1200);
    const restored = new GelofusinFluidTherapyRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(15_600)).toEqual(runtime.projectionsAt(15_600));
  });

  test("active infusion checkpoint continues delivery and decay deterministically", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 1000 }), circulation); runtime.advanceTo(1800);
    const restored = new GelofusinFluidTherapyRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(7200)).toEqual(runtime.projectionsAt(7200));
  });

  test("rate-change checkpoint does not double-count delivery or effective volume", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 600 }), circulation);
    runtime.execute(gelofusin({ commandId: "GELO-RATE", action: "CHANGE_RATE", simulationTimeSec: 3600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: 1200 }), circulation);
    const restored = new GelofusinFluidTherapyRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(7200)).toEqual(runtime.projectionsAt(7200));
  });

  test("stopped infusion checkpoint preserves no-new-delivery residual decay", () => {
    const runtime = new GelofusinFluidTherapyRuntime();
    runtime.execute(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined, volumeUnit: undefined,
      rateMlHour: 1000 }), circulation);
    runtime.execute(gelofusin({ commandId: "GELO-STOP", action: "STOP", simulationTimeSec: 3600,
      mode: undefined, prescribedVolumeMl: undefined, volumeUnit: undefined, vascularAccessId: undefined,
      rateMlHour: undefined, rateUnit: undefined }), circulation);
    const restored = new GelofusinFluidTherapyRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(18_000)).toEqual(runtime.projectionsAt(18_000));
  });

  test("mixed checkpoint restores all three fluids independently", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(fluid("RINGER", "RINGER-1"), circulation);
    medication.executeFluidTherapy(fluid("SODIUM_CHLORIDE_0_9", "NACL-1"), circulation);
    medication.executeFluidTherapy(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1000 }), circulation);
    medication.advanceTo(3600);
    const snapshot = medication.snapshot();
    expect(snapshot.fluidTherapy?.additionalProducts?.map(item => item.configuration.fluidType))
      .toEqual(["SODIUM_CHLORIDE_0_9", "GELOFUSIN"]);
    const restored = new MedicationEngine(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.fluidTherapyProjectionsAt(10_800)).toEqual(medication.fluidTherapyProjectionsAt(10_800));
  });

  test("Scenario checkpoint preserves all fluids, norepinephrine and final hemodynamics", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(fluid("RINGER", "RINGER-1"), patient, accessId));
    engine.executeFluidTherapyCommand(atScenarioTime(fluid("SODIUM_CHLORIDE_0_9", "NACL-1"), patient, accessId));
    engine.executeFluidTherapyCommand(atScenarioTime(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1000 }), patient, accessId));
    engine.executeNorepinephrineCommand({ commandId: "NE", action: "START", infusionId: "NE-1", patientId: patient,
      simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: accessId });
    engine.advanceTo(3780); engine.dispatch(tick(3780, patient));
    const payload = engine.captureRuntimePayload();
    const before = engine.getRuntimeState();
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getFluidTherapyState()).toEqual(engine.getFluidTherapyState());
    expect(restored.getNorepinephrineState()).toEqual(engine.getNorepinephrineState());
    expect(restored.getRuntimeState().vitalSignState).toEqual(before.vitalSignState);
  });

  test("assessment and debug projections expose colloid persistence state", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1000 }), patient, accessId));
    engine.advanceTo(3780); engine.dispatch(tick(3780, patient));
    const assessment = engine.getAssessmentSnapshot().clinicalFeatures ?? [];
    expect(assessment).toContainEqual(expect.objectContaining({
      featureId: "GELOFUSIN",
      fluidClass: "COLLOID",
      effectiveVolumePersistence: { model: "EXPONENTIAL_DECAY", halfLifeSec: 7200 },
      effectiveVolumeAnchorMl: 0,
      effectiveVolumeAnchorAtSimulationTimeSec: 180,
    }));
    const debug = getPatientResourceDebugSnapshot(patient).medicationState?.clinicalFeatures ?? [];
    expect(debug).toContainEqual(expect.objectContaining({ featureId: "GELOFUSIN", fluidClass: "COLLOID" }));
  });

  test("Gelofusin and norepinephrine remain separate volume and vasopressor contributors", () => {
    const { engine, accessId, patient } = engineWithAccess();
    engine.executeFluidTherapyCommand(atScenarioTime(gelofusin({ mode: "INFUSION", prescribedVolumeMl: undefined,
      volumeUnit: undefined, rateMlHour: 1000 }), patient, accessId));
    engine.executeNorepinephrineCommand({ commandId: "NE", action: "START", infusionId: "NE-1", patientId: patient,
      simulationTimeSec: 180, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: accessId });
    engine.advanceTo(300); engine.dispatch(tick(300, patient));
    const contributors = engine.getRuntimeState().vitalSignState!.activeContributors;
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "VOLUME_RESUSCITATION", sourceId: "GELO-1" }));
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "MEDICATION", sourceId: "NE-1" }));
  });

  test("absence of Gelofusin preserves Ringer and NaCl checkpoint representation", () => {
    const medication = new MedicationEngine();
    medication.executeFluidTherapy(fluid("RINGER", "RINGER-1"), circulation);
    medication.executeFluidTherapy(fluid("SODIUM_CHLORIDE_0_9", "NACL-1"), circulation);
    const snapshot = medication.snapshot();
    expect(snapshot.fluidTherapy?.additionalProducts).toHaveLength(1);
    expect(snapshot.fluidTherapy?.additionalProducts?.[0].configuration.fluidType).toBe("SODIUM_CHLORIDE_0_9");
    expect(JSON.stringify(snapshot)).not.toContain("GELOFUSIN");
  });

  test("pelvic hemorrhage conserves blood loss and has no Gelofusin source-control shortcut", () => {
    const treated = engineWithAccess(pressureDependentHemorrhageFixture);
    const control = engineWithAccess(pressureDependentHemorrhageFixture).engine;
    treated.engine.executeFluidTherapyCommand(atScenarioTime(gelofusin({ mode: "INFUSION",
      prescribedVolumeMl: undefined, volumeUnit: undefined, rateMlHour: 3000 }), treated.patient, treated.accessId));
    for (const time of [240, 300, 360, 420, 480, 540, 600]) {
      treated.engine.advanceTo(time); treated.engine.dispatch(tick(time, treated.patient, `GELO-${time}`));
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
    expect(treatedHemorrhage.clinicalState.cumulativeLossMl)
      .toBeGreaterThanOrEqual(controlHemorrhage.clinicalState.cumulativeLossMl);
    expect(treatedHemorrhage.clinicalState.activeEffects.some(effect =>
      ["REDUCE_EXTERNAL_BLEEDING", "STOP_EXTERNAL_BLEEDING", "PELVIC_STABILIZATION"].includes(effect.effectType)))
      .toBe(false);
  });
});
