import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { GoldenFixture } from "@/models/GoldenTest";
import type { HemorrhageConfiguration } from "@/models/HemorrhagePatientProcess";
import type { PleuralInjuryConfiguration, PleuralInjuryPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { PLEURAL_INJURY_REFERENCE } from "@/modules/pleuralInjury/PleuralInjuryReference";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { applyPleuralEffects, bootstrapPleuralInjuryPatientProcess, defaultPleuralInjuryConfiguration, tickPleuralInjuryPatientProcess } from "@/services/runtime/PleuralInjuryPatientProcess";
import { canonicalRuntimePersistenceService } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import { PLEURAL_INJURY_EXERCISE_PACKAGE, PLEURAL_INJURY_WP45B_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { packagePatientDatasetRegistry, pleuralWp45bFixture } from "@/services/exercise/CanonicalPatientDatasets";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";

const ongoingRate = 400 / 60;
const config: PleuralInjuryConfiguration = {
  ...defaultPleuralInjuryConfiguration,
  initialAirBurden: 70,
  initialBloodBurdenMl: 1450,
  bloodAccumulationPerMin: ongoingRate,
  initialDrainageVolumeMl: 1450,
  ongoingDrainOutputRateMlMin: ongoingRate,
  postDrainRespiratoryRecovery: {
    spo2RecoveryPerMin: 10, spo2Ceiling: 94, respiratoryRateRecoveryPerMin: 8, respiratoryRateFloor: 30,
    workOfBreathingRecoveryPerMin: 10, workOfBreathingFloor: 25, fatigueRecoveryPerMin: 8, fatigueFloor: 20,
  },
};
const hemorrhageConfig: HemorrhageConfiguration = {
  ...PLEURAL_INJURY_REFERENCE.hemorrhageSources[0].configuration,
  baselineBleedingRateMlMin: ongoingRate,
  bleedingRateAfterPleuralDrainageMlMin: ongoingRate,
  bloodProductOffsetMlMin: 3,
};
const drainEffect = (id = "DRAIN-1", timestamp = 60): ClinicalEffect => ({
  effectId: id, effectType: "PLEURAL_DRAINAGE", encounterId: "PT-THORAX", patientId: "PT-THORAX",
  timestamp, sourceInterventionInstanceId: "CHEST-DRAIN-1", parameters: {},
});
const bloodEffect: ClinicalEffect = {
  effectId: "RBC-1", effectType: "BLOOD_PRODUCT_STARTED", encounterId: "PT-THORAX", patientId: "PT-THORAX",
  timestamp: 120, sourceInterventionInstanceId: "RBC-1", parameters: {},
};

function drained() {
  return applyPleuralEffects(bootstrapPleuralInjuryPatientProcess("PT-THORAX", { configuration: config }), [drainEffect()]);
}

function fixture(): GoldenFixture {
  return {
    fixtureId: "FX-WP45B", fixtureType: "PROCESS", patientId: "PT-THORAX", seed: 45, clockState: "RUNNING", ownershipVersion: 1,
    loadedModules: ["PLEURAL_INJURY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1"],
    activeResources: { resources: [{ resourceId: "CD-1", type: "chestDrain", status: "AVAILABLE", metadata: {} }] },
    initialState: {
      processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
      pleuralInjury: { processId: "PT-THORAX:PLEURAL:1", instanceKey: "PT-THORAX:pleural:1", templateId: "THORACIC_CONFIG_TEST", configuration: config },
      respiratoryFailure: { ...PLEURAL_INJURY_REFERENCE.respiratoryFailure, processId: "PT-THORAX:RF:1", instanceKey: "PT-THORAX:rf:1" },
      hypoxia: { ...PLEURAL_INJURY_REFERENCE.hypoxia, processId: "PT-THORAX:HYP:1", instanceKey: "PT-THORAX:hyp:1" },
      hemorrhageSources: [{ processId: "PT-THORAX:HEM:1", instanceKey: "PT-THORAX:hem:1", sourceId: "THORACIC-1", sourceType: "THORACIC", templateId: "THORACIC_CONFIG_TEST", estimatedBloodLossMl: 1450, configuration: hemorrhageConfig }],
    },
  };
}

const tick = (step: number, offsetSec: number) => ({ sequenceId: "WP45B", step, offsetSec, eventType: "ENGINE_TICK" as const,
  actor: "ENGINE", target: "PT-THORAX", eventId: `TICK-${step}`, result: "SUCCESS" as const, payload: { tickMin: 1 } });

describe("WP-45B configurable thoracic bleeding and drainage", () => {
  test("publishes a new immutable physical-acceptance version without changing 1.0.0", () => {
    const oldPublished = exercisePackageRegistry.require(PLEURAL_INJURY_EXERCISE_PACKAGE.packageId, PLEURAL_INJURY_EXERCISE_PACKAGE.packageVersion);
    const newPublished = exercisePackageRegistry.require(PLEURAL_INJURY_WP45B_EXERCISE_PACKAGE.packageId, PLEURAL_INJURY_WP45B_EXERCISE_PACKAGE.packageVersion);
    expect(oldPublished).toMatchObject({ packageId: "russicaptor.pleural-injury-reference", packageVersion: "1.0.0",
      patientDatasetId: "patients.pleural-injury-reference.v1", packageHash: "bd782311d4038457371bfdb367e18ae6a0f9d6802050c04c3b27e834e82ae35e" });
    expect(newPublished).toMatchObject({ packageId: "russicaptor.pleural-injury-reference", packageVersion: "1.1.0",
      patientDatasetId: "patients.pleural-injury-reference.v2", packageHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(newPublished.packageHash).not.toBe(oldPublished.packageHash);
  });

  test("materializes only the configured 1450 ml / 400 ml-h acceptance patient", () => {
    const plan = createPatientMaterializationPlan("EX-WP45B-PHYSICAL", PLEURAL_INJURY_WP45B_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    expect(plan.patients).toHaveLength(1);
    expect(plan.patients[0]).toMatchObject({ patient: { id: "PT-PLEURAL-WP45B-001", isikukood: "50101010009" }, runtimeFixture: { fixtureId: "FX-PLEURAL-WP45B-1.1" } });
    const initial = pleuralWp45bFixture.initialState as Record<string, any>;
    expect(initial.pleuralInjury.configuration).toMatchObject({ initialBloodBurdenMl: 1450, initialDrainageVolumeMl: 1450, ongoingDrainOutputRateMlMin: ongoingRate });
    expect(initial.hemorrhageSources[0]).toMatchObject({ estimatedBloodLossMl: 1450, configuration: { baselineBleedingRateMlMin: ongoingRate,
      bleedingRateAfterPleuralDrainageMlMin: ongoingRate } });
    expect(initial.hemorrhageSources[0].configuration.baselineBleedingRateMlMin).not.toBe(120);
  });

  test("acceptance fixture exposes canonical pre-drain vital measurements", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(pleuralWp45bFixture);
    const state = engine.getRuntimeState();
    expect(state.vitalSignState?.readings).toMatchObject({
      heartRate: { current: expect.any(Number) }, systolicBp: { current: expect.any(Number) }, diastolicBp: { current: expect.any(Number) },
      respiratoryRate: { current: expect.any(Number) }, spo2: { current: expect.any(Number) },
    });
    expect(state.vitalSignState?.derived.meanArterialPressure).toEqual(expect.any(Number));
    const presentation = getCanonicalPatientRuntimeSnapshot("PT-PLEURAL-WP45B-001")!;
    expect(presentation.processes.find(process => process.moduleId === "PLEURAL_INJURY_V1")?.clinicalState)
      .toMatchObject({ totalDrainOutputMl: 0, initialDrainageCompleted: false });
    expect(presentation.processes.find(process => process.moduleId === "HEMORRHAGE_V1")?.clinicalState)
      .toMatchObject({ cumulativeLossMl: 1450, bleedingRateMlMin: ongoingRate });
  });

  test("starts with canonical pleural burden and active thoracic hemorrhage", () => {
    const pleural = bootstrapPleuralInjuryPatientProcess("PT-THORAX", { configuration: config });
    const hemorrhage = bootstrapHemorrhagePatientProcess("PT-THORAX", { sourceType: "THORACIC", estimatedBloodLossMl: 1450, configuration: hemorrhageConfig });
    expect(pleural.clinicalState).toMatchObject({ bloodBurdenMl: 1450, drainageActive: false });
    expect(hemorrhage.clinicalState).toMatchObject({ cumulativeLossMl: 1450, activeHemorrhage: true });
    expect(pleural.outputs.runtimeContributions?.respiratoryImpairmentMultiplier).toBeGreaterThan(1);
  });

  test("evacuates the configured initial volume once without creating hemorrhage loss", () => {
    const hemorrhage = bootstrapHemorrhagePatientProcess("PT-THORAX", { sourceType: "THORACIC", estimatedBloodLossMl: 1450, configuration: hemorrhageConfig });
    const first = drained(); const second = applyPleuralEffects(first, [drainEffect()]);
    expect(first.clinicalState).toMatchObject({ initialDrainageCompleted: true, initialDrainageVolumeMl: 1450, totalDrainOutputMl: 1450, bloodBurdenMl: 0 });
    expect(second).toEqual(first);
    expect(hemorrhage.clinicalState.cumulativeLossMl).toBe(1450);
  });

  test.each([[30, 1650], [60, 1850], [90, 2050]])("adds 400 ml/h to drain output for %i minutes", (minutes, total) => {
    const progressed = tickPleuralInjuryPatientProcess(drained(), minutes * 60);
    expect(progressed.clinicalState.totalDrainOutputMl).toBeCloseTo(total, 6);
    expect(progressed.clinicalState.ongoingDrainOutputMl).toBeCloseTo(total - 1450, 6);
  });

  test("manual +60 advances ongoing output without repeating the initial drainage", () => {
    const first = drained(); const after = tickPleuralInjuryPatientProcess(first, 60);
    expect(after.clinicalState.initialDrainageVolumeMl).toBe(1450);
    expect(after.clinicalState.ongoingDrainOutputMl).toBeCloseTo(ongoingRate, 6);
  });

  test("pleural drainage improves respiratory contribution while thoracic loss continues", () => {
    const before = bootstrapPleuralInjuryPatientProcess("PT-THORAX", { configuration: config });
    const after = drained();
    expect(Number(after.outputs.runtimeContributions?.respiratoryImpairmentMultiplier)).toBeLessThan(Number(before.outputs.runtimeContributions?.respiratoryImpairmentMultiplier));
    const hemorrhage = bootstrapHemorrhagePatientProcess("PT-THORAX", { sourceType: "THORACIC", estimatedBloodLossMl: 1450, configuration: hemorrhageConfig });
    const progressed = tickHemorrhagePatientProcess(setHemorrhageEffects(hemorrhage, [drainEffect()]), 60).process;
    expect(progressed.clinicalState.bleedingRateMlMin).toBeCloseTo(ongoingRate, 6);
    expect(progressed.clinicalState.cumulativeLossMl).toBeGreaterThan(1450);
  });

  test("canonical vital projection improves respiration while circulation remains hemorrhage-sensitive", () => {
    const engine = new ClinicalScenarioEngine(); const untreated = new ClinicalScenarioEngine();
    engine.reset(fixture()); untreated.reset(fixture());
    engine.advanceTo(60); engine.dispatch(tick(1, 60)); untreated.advanceTo(60); untreated.dispatch(tick(1, 60));
    engine.scheduleIntervention({ interventionId: "CD-VITALS", patientId: "PT-THORAX", resourceId: "CD-1", action: "APPLY", timestamp: 120, definitionId: "CHEST_DRAIN_INSERTION" });
    engine.advanceTo(120); engine.dispatch(tick(2, 120)); untreated.advanceTo(120); untreated.dispatch(tick(2, 120));
    const after = engine.getRuntimeState().vitalSignState!.readings;
    const withoutDrain = untreated.getRuntimeState().vitalSignState!.readings;
    expect(after.spo2.current).toBeGreaterThan(withoutDrain.spo2.current);
    expect(after.respiratoryRate.current).toBeLessThan(withoutDrain.respiratoryRate.current);
    expect(after.heartRate.current).toBeGreaterThanOrEqual(withoutDrain.heartRate.current);
  });

  test("functioning drainage produces absolute residual respiratory recovery while circulation worsens", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(fixture());
    for (let minute = 1; minute <= 10; minute += 1) { engine.advanceTo(minute * 60); engine.dispatch(tick(minute, minute * 60)); }
    const before = engine.getRuntimeState();
    engine.scheduleIntervention({ interventionId: "CD-RECOVERY", patientId: "PT-THORAX", resourceId: "CD-1", action: "APPLY", timestamp: 600, definitionId: "CHEST_DRAIN_INSERTION" });
    engine.applyScheduledResourceInterventionsAtCurrentTime();
    for (let minute = 11; minute <= 13; minute += 1) { engine.advanceTo(minute * 60); engine.dispatch(tick(minute, minute * 60)); }
    const after = engine.getRuntimeState();
    expect(after.vitalSignState!.readings.spo2.current).toBeGreaterThan(before.vitalSignState!.readings.spo2.current);
    expect(after.vitalSignState!.readings.spo2.current).toBeLessThanOrEqual(94);
    expect(after.vitalSignState!.readings.respiratoryRate.current).toBeLessThan(before.vitalSignState!.readings.respiratoryRate.current);
    expect(after.vitalSignState!.readings.respiratoryRate.current).toBeGreaterThanOrEqual(30);
    expect(after.vitalSignState!.readings.systolicBp.current).toBeLessThan(before.vitalSignState!.readings.systolicBp.current);
    const processes = engine.getPatientProcesses();
    expect(processes.find(process => process.processType === "RESPIRATORY_FAILURE")?.clinicalState)
      .toMatchObject({ trend: "IMPROVING" });
    expect(processes.find(process => process.processType === "HYPOXIA")?.clinicalState)
      .toMatchObject({ spo2Trend: "IMPROVING" });
  });

  test("blood-product support composes without stopping ongoing thoracic bleeding", () => {
    const hemorrhage = bootstrapHemorrhagePatientProcess("PT-THORAX", { sourceType: "THORACIC", estimatedBloodLossMl: 1450, configuration: hemorrhageConfig });
    const unsupported = tickHemorrhagePatientProcess(setHemorrhageEffects(hemorrhage, [drainEffect()]), 60).process;
    const supported = tickHemorrhagePatientProcess(setHemorrhageEffects(hemorrhage, [drainEffect(), bloodEffect]), 60).process;
    expect(supported.clinicalState.bleedingRateMlMin).toBeGreaterThan(0);
    expect(supported.clinicalState.bleedingRateMlMin).toBeLessThan(unsupported.clinicalState.bleedingRateMlMin);
  });

  test("canonical capture/rehydration preserves drainage and does not replay its bolus", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(fixture());
    engine.scheduleIntervention({ interventionId: "CD-PERSIST", patientId: "PT-THORAX", resourceId: "CD-1", action: "APPLY", timestamp: 60, definitionId: "CHEST_DRAIN_INSERTION" });
    engine.advanceTo(60); engine.dispatch(tick(1, 60));
    const identity = { exerciseId: "EX-WP45B", patientId: "PT-THORAX", packageId: "technical.pleural", packageVersion: "1.0.0", packageHash: "P", definitionHash: "D", moduleCompositionHash: "M" };
    const artifact = canonicalRuntimePersistenceService.capture(engine, identity);
    const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
    const before = resumed.getPatientProcesses().find(process => process.processType === "PLEURAL_INJURY") as unknown as PleuralInjuryPatientProcessRuntime;
    resumed.advanceTo(120); resumed.dispatch(tick(2, 120));
    const after = resumed.getPatientProcesses().find(process => process.processType === "PLEURAL_INJURY") as unknown as PleuralInjuryPatientProcessRuntime;
    expect(after.clinicalState.initialDrainageVolumeMl).toBe(before.clinicalState.initialDrainageVolumeMl);
    expect(after.clinicalState.totalDrainOutputMl).toBeGreaterThan(before.clinicalState.totalDrainOutputMl as number);
    expect(resumed.getEventLog().filter(event => event.eventType === "ClinicalEffectApplied" && (event.payload as Record<string, unknown>).effectType === "PLEURAL_DRAINAGE")).toHaveLength(1);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid extended drainage value %p", (value) => {
    expect(() => bootstrapPleuralInjuryPatientProcess("PT-THORAX", { configuration: { ...config, ongoingDrainOutputRateMlMin: value } })).toThrow("mittenegatiivne lõplik arv");
  });
});
