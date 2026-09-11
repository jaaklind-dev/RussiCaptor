import type { CirculationState } from "@/models/CirculationState";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { SupportedFluidTherapyCommand } from "@/models/FluidTherapy";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import type { TranexamicAcidCommand } from "@/models/TranexamicAcid";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture, pressureDependentHemorrhageFixture } from "@/services/exercise/CanonicalPatientDatasets";
import {
  bootstrapHemorrhagePatientProcess,
  effectiveFibrinolysisFactor,
  setHemorrhageEffects,
  tickHemorrhagePatientProcess,
} from "@/services/runtime/HemorrhagePatientProcess";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import {
  DEFAULT_TRANEXAMIC_ACID_CONFIGURATION,
  TranexamicAcidRuntime,
  classifyTranexamicAcidTiming,
  tranexamicAcidClinicalFeatureContract,
  tranexamicAcidEffectAt,
} from "@/services/runtime/medication/TranexamicAcid";

const patientId = "PT-TXA-1";
const circulation: CirculationState = {
  patientId,
  vascularAccess: [
    { interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["PIV-1"], establishedAt: 0 },
    { interventionInstanceId: "IO-1", type: "IO", resourceIds: ["IO-1"], establishedAt: 0 },
  ],
  hemorrhageControl: [], runningInfusions: [], updatedAt: 0,
};

const command = (overrides: Partial<TranexamicAcidCommand> = {}): TranexamicAcidCommand => ({
  commandId: "TXA-START", action: "START", regimenId: "TXA-REGIMEN-1", patientId,
  simulationTimeSec: 0, vascularAccessId: "IV-1", ...overrides,
});

const txaEffect = (value: number): ClinicalEffect => ({
  effectId: "TXA:EFFECT", effectType: "ANTIFIBRINOLYTIC_SUPPORT", encounterId: patientId,
  patientId, timestamp: 0, sourceInterventionInstanceId: "TXA-REGIMEN-1", parameters: { txaEffect: value },
});

const hemorrhageConfiguration = (fibrinolysis = true) => ({
  baselineBleedingRateMlMin: 100, tourniquetEfficiency: 0.9, binderEfficiency: 0.6,
  infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0,
  ...(fibrinolysis ? { fibrinolysis: { excessFactor: 1.5, txaSensitivity: 0.8 } } : {}),
  coagulation: { temperatureModifiers: [{ belowCelsius: 35, factor: 1.25 }] },
  severityThresholdsMl: [300, 700, 1200, 1800] as const,
  perfusionThresholdsMl: [600, 1100, 1700] as const,
  compensationThresholdsMl: [900, 1600] as const,
  trendThresholdsMlMin: { worsening: 80, improving: 30 },
});

const hemorrhage = (fibrinolysis = true) => bootstrapHemorrhagePatientProcess(patientId, {
  sourceId: "PELVIC", sourceType: "PELVIC", configuration: hemorrhageConfiguration(fibrinolysis),
});

const tick = (simulationTimeSec: number, target: string, eventId: string): GoldenInputEvent => ({
  sequenceId: "TXA", step: simulationTimeSec, offsetSec: simulationTimeSec, eventType: "ENGINE_TICK",
  actor: "ENGINE", target, eventId, result: "SUCCESS", payload: { tickMin: 1 },
});

function hyperfibrinolyticFixture(): GoldenFixture {
  const fixture = structuredClone(pressureDependentHemorrhageFixture);
  const initial = fixture.initialState as Record<string, unknown>;
  const sources = structuredClone(initial.hemorrhageSources) as Record<string, unknown>[];
  sources[0].configuration = { ...(sources[0].configuration as Record<string, unknown>),
    fibrinolysis: { excessFactor: 1.5, txaSensitivity: 1 } };
  return { ...fixture, fixtureId: "FX-TXA-HYPERFIBRINOLYSIS", initialState: { ...initial, hemorrhageSources: sources } };
}

function engineWithAccess(fixture: GoldenFixture = mtpReferenceFixture): {
  engine: ClinicalScenarioEngine; patient: string; accessId: string;
} {
  const patient = fixture.patientId!;
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.scheduleIntervention({ interventionId: `PIV-TXA-${patient}`, patientId: patient,
    resourceId: "PIV-1", action: "APPLY", timestamp: 0, definitionId: "PERIPHERAL_IV_ACCESS",
    parameters: { location: "arm", gauge: 18, attempts: 1 } });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
  engine.advanceTo(180);
  engine.dispatch(tick(180, patient, `ACCESS-${patient}`));
  return { engine, patient, accessId: engine.getCirculationState(patient).vascularAccess[0].interventionInstanceId };
}

describe("Tranexamic acid antifibrinolytic clinical feature", () => {
  test("uses canonical identity, antifibrinolytic category and state version", () => {
    expect(tranexamicAcidClinicalFeatureContract).toMatchObject({
      featureId: "TRANEXAMIC_ACID", category: "ANTIFIBRINOLYTIC", schemaVersion: 1,
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
      physiology: { combine: "HEMORRHAGE_HEMOSTASIS_LAYER" },
    });
  });

  test("defines the configuration-driven 1 g loading and 1 g maintenance regimen", () => {
    expect(DEFAULT_TRANEXAMIC_ACID_CONFIGURATION).toEqual({ schemaVersion: 1,
      regimenVersion: "TXA_TRAUMA_REGIMEN_V1", loadingDoseMg: 1000, loadingDurationSec: 600,
      maintenanceDoseMg: 1000, maintenanceDurationSec: 28_800,
      eligibleTraumaWindowSec: 10_800, effectHalfLifeSec: 7200 });
  });

  test("starts one loading regimen through valid IV access", () => {
    const runtime = new TranexamicAcidRuntime();
    expect(runtime.execute(command(), circulation)).toMatchObject({ status: "APPLIED", state: {
      featureId: "TRANEXAMIC_ACID", route: "IV", lifecycle: "LOADING", loadingStatus: "RUNNING",
      maintenanceStatus: "NOT_STARTED", loadingDeliveredMg: 0, maintenanceDeliveredMg: 0,
    } });
  });

  test("loading delivery is smooth, partial and exactly 1 g over 600 seconds", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    expect(runtime.projectionsAt(300)[0]).toMatchObject({ lifecycle: "LOADING", loadingDeliveredMg: 500,
      currentAntifibrinolyticEffect: 0.5 });
    runtime.advanceTo(600);
    expect(runtime.projectionsAt(600)[0]).toMatchObject({ lifecycle: "MAINTENANCE", loadingDeliveredMg: 1000,
      maintenanceDeliveredMg: 0, currentAntifibrinolyticEffect: 1 });
  });

  test("loading transitions automatically to maintenance exactly once", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    runtime.advanceTo(600); runtime.advanceTo(601); runtime.advanceTo(1000);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "TranexamicAcidMaintenanceStarted"))
      .toHaveLength(1);
  });

  test("maintenance delivers the additional 1 g over 8 hours without increasing effect above one", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    runtime.advanceTo(15_000);
    expect(runtime.projectionsAt(15_000)[0]).toMatchObject({ lifecycle: "MAINTENANCE",
      loadingDeliveredMg: 1000, maintenanceDeliveredMg: 500, currentAntifibrinolyticEffect: 1 });
  });

  test("full regimen completes exactly with no over-delivery or duplicate completion", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    runtime.advanceTo(29_400); runtime.advanceTo(99_999);
    expect(runtime.projectionsAt(99_999)[0]).toMatchObject({ lifecycle: "COMPLETED",
      loadingDeliveredMg: 1000, maintenanceDeliveredMg: 1000, completedAtSimulationTimeSec: 29_400 });
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "TranexamicAcidRegimenCompleted"))
      .toHaveLength(1);
  });

  test("stop during loading halts delivery and preserves a decaying residual effect", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    const stop = command({ commandId: "TXA-STOP", action: "STOP", simulationTimeSec: 300,
      vascularAccessId: undefined });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.projectionsAt(300)[0]).toMatchObject({ lifecycle: "STOPPED", loadingStatus: "STOPPED",
      loadingDeliveredMg: 500, maintenanceDeliveredMg: 0, currentAntifibrinolyticEffect: 0.5 });
    expect(runtime.projectionsAt(7500)[0].currentAntifibrinolyticEffect).toBe(0.25);
    expect(runtime.projectionsAt(7500)[0].loadingDeliveredMg).toBe(500);
  });

  test("stop during maintenance preserves completed loading and partial maintenance", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    runtime.advanceTo(15_000);
    runtime.execute(command({ commandId: "TXA-STOP-M", action: "STOP", simulationTimeSec: 15_000,
      vascularAccessId: undefined }));
    expect(runtime.projectionsAt(15_000)[0]).toMatchObject({ lifecycle: "STOPPED", loadingStatus: "COMPLETED",
      maintenanceStatus: "STOPPED", loadingDeliveredMg: 1000, maintenanceDeliveredMg: 500 });
  });

  test("duplicate start and stop commands are idempotent", () => {
    const runtime = new TranexamicAcidRuntime(); const start = command();
    expect(runtime.execute(start, circulation).status).toBe("APPLIED");
    expect(runtime.execute(start, circulation).status).toBe("IDEMPOTENT");
    const stop = command({ commandId: "TXA-STOP", action: "STOP", simulationTimeSec: 300,
      vascularAccessId: undefined });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.execute(stop).status).toBe("IDEMPOTENT");
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "TranexamicAcidLoadingStarted"))
      .toHaveLength(1);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "TranexamicAcidRegimenStopped"))
      .toHaveLength(1);
  });

  test("supports existing IV and IO access while invalid and wrong-patient access fails closed", () => {
    expect(new TranexamicAcidRuntime().execute(command({ vascularAccessId: "IO-1" }), circulation).state?.route)
      .toBe("IO");
    expect(new TranexamicAcidRuntime().execute(command({ vascularAccessId: "UNKNOWN" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    expect(new TranexamicAcidRuntime().execute(command({ patientId: "OTHER" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_PATIENT" });
  });

  test("delivery and effect depend only on simulation time", () => {
    const first = new TranexamicAcidRuntime(); const second = new TranexamicAcidRuntime();
    first.execute(command(), circulation); second.execute(command(), circulation);
    first.advanceTo(12_345); second.advanceTo(12_345);
    expect(second.snapshot()).toEqual(first.snapshot());
    expect(second.projectionsAt(20_000)).toEqual(first.projectionsAt(20_000));
  });

  test("completed treatment retains effect and then follows configured half-life decay", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation); runtime.advanceTo(29_400);
    const state = runtime.snapshot()!.regimens[0];
    expect(tranexamicAcidEffectAt(state, 29_400)).toBe(1);
    expect(tranexamicAcidEffectAt(state, 36_600)).toBe(0.5);
    expect(tranexamicAcidEffectAt(state, 43_800)).toBe(0.25);
  });

  test("authoritative trauma timing classification includes the exact 3-hour boundary", () => {
    expect(classifyTranexamicAcidTiming(0, 0)).toBe("WITHIN_WINDOW");
    expect(classifyTranexamicAcidTiming(3600, 0)).toBe("WITHIN_WINDOW");
    expect(classifyTranexamicAcidTiming(10_799, 0)).toBe("WITHIN_WINDOW");
    expect(classifyTranexamicAcidTiming(10_800, 0)).toBe("WITHIN_WINDOW");
    expect(classifyTranexamicAcidTiming(10_801, 0)).toBe("LATE");
  });

  test("missing authoritative injury time is explicitly deferred", () => {
    expect(classifyTranexamicAcidTiming(5000, undefined))
      .toBe("TRAUMA_WINDOW_CLASSIFICATION_DEFERRED_NO_AUTHORITATIVE_INJURY_TIME");
    expect(new TranexamicAcidRuntime().execute(command(), circulation).state?.timingClassification)
      .toBe("TRAUMA_WINDOW_CLASSIFICATION_DEFERRED_NO_AUTHORITATIVE_INJURY_TIME");
  });

  test("late administration remains visible but has no modeled antifibrinolytic benefit", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command({ simulationTimeSec: 10_801 }),
      { ...circulation, updatedAt: 10_801 }, 0);
    expect(runtime.projectionsAt(11_401)[0]).toMatchObject({ timingClassification: "LATE",
      currentAntifibrinolyticEffect: 0 });
  });

  test("invalid configuration is rejected", () => {
    expect(() => new TranexamicAcidRuntime({ ...DEFAULT_TRANEXAMIC_ACID_CONFIGURATION,
      effectHalfLifeSec: 0 })).toThrow("TRANEXAMIC_ACID_CONFIGURATION_INVALID");
  });

  test.each([
    [1, 1, 1, 1],
    [1.5, 0, 1, 1.5],
    [1.5, 1, 0, 1.5],
    [1.5, 1, 1, 1],
    [0.8, 1, 1, 1],
  ])("bounded fibrinolysis F=%s effect=%s sensitivity=%s resolves %s", (factor, effect, sensitivity, expected) => {
    expect(effectiveFibrinolysisFactor(factor, effect, sensitivity)).toBe(expected);
  });

  test("TXA attenuates only configured fibrinolytic excess", () => {
    const untreated = tickHemorrhagePatientProcess(hemorrhage(), 0, 100, 36.8).process;
    const treated = tickHemorrhagePatientProcess(setHemorrhageEffects(hemorrhage(), [txaEffect(1)]), 0, 100, 36.8).process;
    expect(untreated.clinicalState).toMatchObject({ bleedingRateMlMin: 150, fibrinolysisExcessFactor: 1.5,
      effectiveFibrinolysisFactor: 1.5 });
    expect(treated.clinicalState).toMatchObject({ bleedingRateMlMin: 110, fibrinolysisExcessFactor: 1.5,
      txaEffect: 1, effectiveFibrinolysisFactor: 1.1 });
  });

  test("TXA cannot reduce F=1 mechanically driven bleeding below baseline", () => {
    const process = setHemorrhageEffects(hemorrhage(false), [txaEffect(1)]);
    expect(tickHemorrhagePatientProcess(process, 0, 100, 36.8).process.clinicalState.bleedingRateMlMin)
      .toBe(100);
  });

  test("hypothermia impairment remains while TXA corrects only fibrinolysis", () => {
    const treated = tickHemorrhagePatientProcess(setHemorrhageEffects(hemorrhage(), [txaEffect(1)]),
      0, 100, 34).process;
    expect(treated.clinicalState).toMatchObject({ coagulationFactor: 1.25,
      effectiveFibrinolysisFactor: 1.1, bleedingRateMlMin: 137.5 });
  });

  test.each([
    ["LOADING", 300], ["MAINTENANCE", 15_000], ["COMPLETED", 29_400],
  ])("%s checkpoint round trip preserves regimen and effect", (_phase, at) => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation); runtime.advanceTo(at);
    const restored = new TranexamicAcidRuntime(); restored.restore(runtime.snapshot());
    expect(restored.snapshot()).toEqual(runtime.snapshot());
    expect(restored.projectionsAt(at + 100)).toEqual(runtime.projectionsAt(at + 100));
  });

  test("stopped checkpoint round trip preserves residual decay", () => {
    const runtime = new TranexamicAcidRuntime(); runtime.execute(command(), circulation);
    runtime.execute(command({ commandId: "STOP", action: "STOP", simulationTimeSec: 300,
      vascularAccessId: undefined }));
    const restored = new TranexamicAcidRuntime(); restored.restore(runtime.snapshot());
    expect(restored.projectionsAt(7500)).toEqual(runtime.projectionsAt(7500));
  });

  test("Medication Runtime omits TXA when unused and restores it independently when used", () => {
    const empty = new MedicationEngine(); expect(empty.snapshot()).not.toHaveProperty("tranexamicAcid");
    empty.executeTranexamicAcid(command(), circulation);
    empty.advanceTo(12_000);
    const snapshot = empty.snapshot();
    const restored = new MedicationEngine(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.tranexamicAcidProjectionsAt(20_000)).toEqual(empty.tranexamicAcidProjectionsAt(20_000));
  });

  test("restores an equivalent configuration after JSONB key reordering", () => {
    const source = new TranexamicAcidRuntime();
    source.execute(command({ commandId: "TXA-JSONB", simulationTimeSec: 120 }), circulation, -300);
    const snapshot = source.snapshot()!;
    const reorderedConfiguration = Object.fromEntries(
      Object.entries(snapshot.configuration).reverse(),
    ) as typeof snapshot.configuration;
    const restored = new TranexamicAcidRuntime();

    expect(() => restored.restore({ ...snapshot, configuration: reorderedConfiguration })).not.toThrow();
    expect(restored.snapshot()).toEqual(snapshot);
  });

  test("TXA coexists with Ringer, NaCl, Gelofusin and norepinephrine without volume or vital shortcuts", () => {
    const medication = new MedicationEngine();
    const fluid = (fluidType: "RINGER" | "SODIUM_CHLORIDE_0_9" | "GELOFUSIN", id: string): SupportedFluidTherapyCommand => ({
      commandId: `START-${id}`, action: "START", administrationId: id, patientId, fluidType,
      simulationTimeSec: 0, mode: "INFUSION", rateMlHour: 500, rateUnit: "ML_H", vascularAccessId: "IV-1",
    });
    medication.executeFluidTherapy(fluid("RINGER", "RINGER-1"), circulation);
    medication.executeFluidTherapy(fluid("SODIUM_CHLORIDE_0_9", "NACL-1"), circulation);
    medication.executeFluidTherapy(fluid("GELOFUSIN", "GELO-1"), circulation);
    medication.executeNorepinephrine({ commandId: "NE-START", action: "START", infusionId: "NE-1", patientId,
      simulationTimeSec: 0, doseMicrogramsPerKgMin: 0.2, unit: "MCG_KG_MIN", vascularAccessId: "IV-1" }, circulation);
    medication.executeTranexamicAcid(command(), circulation);
    medication.advanceTo(600);
    expect(medication.fluidTherapyProjectionsAt(600)).toHaveLength(3);
    expect(medication.norepinephrineProjectionsAt(600)).toHaveLength(1);
    expect(medication.tranexamicAcidProjectionsAt(600)).toHaveLength(1);
    expect(medication.vitalContributorsAt(600).some(item => item.sourceId === "TXA-REGIMEN-1")).toBe(false);
    expect(medication.activeEffects(600)).toContainEqual(expect.objectContaining({
      effectType: "ANTIFIBRINOLYTIC_SUPPORT", parameters: expect.objectContaining({ txaEffect: 1 }),
    }));
  });

  test("historical pelvic fixture remains byte-for-byte absent of TXA and fibrinolysis state", () => {
    const first = new ClinicalScenarioEngine(); const second = new ClinicalScenarioEngine();
    first.reset(pressureDependentHemorrhageFixture); second.reset(pressureDependentHemorrhageFixture);
    first.advanceTo(60); second.advanceTo(60);
    first.dispatch(tick(60, pressureDependentHemorrhageFixture.patientId!, "BASE-1"));
    second.dispatch(tick(60, pressureDependentHemorrhageFixture.patientId!, "BASE-1"));
    expect(second.captureRuntimePayload()).toEqual(first.captureRuntimePayload());
    expect(JSON.stringify(first.captureRuntimePayload())).not.toContain("tranexamicAcid");
    expect(JSON.stringify(first.captureRuntimePayload())).not.toContain("fibrinolysisExcessFactor");
  });

  test("hyperfibrinolytic pelvic fixture reduces only excess while source-control and pressure config remain unchanged", () => {
    const treated = engineWithAccess(hyperfibrinolyticFixture());
    const control = engineWithAccess(hyperfibrinolyticFixture()).engine;
    treated.engine.executeTranexamicAcidCommand({ ...command(), patientId: treated.patient,
      simulationTimeSec: 180, vascularAccessId: treated.accessId });
    treated.engine.advanceTo(780); control.advanceTo(780);
    treated.engine.dispatch(tick(780, treated.patient, "TXA-HYPER-TREATED"));
    control.dispatch(tick(780, treated.patient, "TXA-HYPER-CONTROL"));
    const treatedHemorrhage = treated.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    const controlHemorrhage = control.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    expect(treatedHemorrhage.clinicalState.effectiveFibrinolysisFactor).toBe(1);
    expect(controlHemorrhage.clinicalState.effectiveFibrinolysisFactor).toBe(1.5);
    expect(treatedHemorrhage.clinicalState.bleedingRateMlMin)
      .toBeLessThan(controlHemorrhage.clinicalState.bleedingRateMlMin);
    expect(treatedHemorrhage.configuration.pelvicSourceControl)
      .toEqual(controlHemorrhage.configuration.pelvicSourceControl);
    expect(treatedHemorrhage.configuration.pressureDependentFlow)
      .toEqual(controlHemorrhage.configuration.pressureDependentFlow);
  });

  test("starting TXA never rewrites prior cumulative loss or source-control state", () => {
    const setup = engineWithAccess(hyperfibrinolyticFixture());
    const before = setup.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    setup.engine.executeTranexamicAcidCommand({ ...command(), patientId: setup.patient,
      simulationTimeSec: 180, vascularAccessId: setup.accessId });
    const after = setup.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    expect(after.clinicalState.cumulativeLossMl).toBe(before.clinicalState.cumulativeLossMl);
    expect(after.clinicalState.pelvicStabilizationState).toBe(before.clinicalState.pelvicStabilizationState);
    expect(after.configuration.pelvicSourceControl).toEqual(before.configuration.pelvicSourceControl);
  });

  test("Scenario checkpoint restores loading state, assessment and debug projection deterministically", () => {
    const setup = engineWithAccess(hyperfibrinolyticFixture());
    setup.engine.executeTranexamicAcidCommand({ ...command(), patientId: setup.patient,
      simulationTimeSec: 180, vascularAccessId: setup.accessId });
    setup.engine.advanceTo(480); setup.engine.dispatch(tick(480, setup.patient, "TXA-CHECKPOINT"));
    const assessment = setup.engine.getAssessmentSnapshot().clinicalFeatures ?? [];
    expect(assessment).toContainEqual(expect.objectContaining({ featureId: "TRANEXAMIC_ACID",
      lifecycle: "LOADING", loadingDeliveredMg: 500, currentAntifibrinolyticEffect: 0.5 }));
    expect(getPatientResourceDebugSnapshot(setup.patient).medicationState?.clinicalFeatures)
      .toContainEqual(expect.objectContaining({ featureId: "TRANEXAMIC_ACID" }));
    const payload = setup.engine.captureRuntimePayload();
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getTranexamicAcidState()).toEqual(setup.engine.getTranexamicAcidState());
    expect(restored.getRuntimeState()).toEqual(setup.engine.getRuntimeState());
  });
});
