import type { AirwayState } from "@/models/AirwayState";
import type { CirculationState } from "@/models/CirculationState";
import type { GoldenFixture } from "@/models/GoldenTest";
import type { AnalgesicCommand, AnalgesicDrugId } from "@/models/AnalgesiaMedication";
import type { MechanicalVentilationCommand, MechanicalVentilationSettings } from "@/models/MechanicalVentilation";
import type { SecuredAirwayReference } from "@/services/runtime/respiratory/MechanicalVentilationRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture } from "@/services/exercise/CanonicalPatientDatasets";
import { bootstrapHypoxiaPatientProcess, tickHypoxiaPatientProcess } from "@/services/runtime/HypoxiaPatientProcess";
import {
  bootstrapRespiratoryFailurePatientProcess,
  tickRespiratoryFailurePatientProcess,
} from "@/services/runtime/RespiratoryFailurePatientProcess";
import {
  DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION,
  MechanicalVentilationRuntime,
  mechanicalMinuteVentilationLMin,
  mechanicalVentilationClinicalFeatureContract,
} from "@/services/runtime/respiratory/MechanicalVentilationRuntime";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { analgesicProductById } from "@/services/runtime/medication/AnalgesicProducts";

const patientId = "PT-PELVIC-001";
const settings: MechanicalVentilationSettings = {
  mode: "VOLUME_CONTROL",
  respiratoryRate: 14,
  respiratoryRateUnit: "BREATHS_MIN",
  tidalVolumeMl: 500,
  tidalVolumeUnit: "ML",
  fio2: 0.6,
  peepCmH2O: 5,
  peepUnit: "CM_H2O",
};
const airwayState: AirwayState = {
  patientId,
  activeAirway: "ENDOTRACHEAL",
  currentVentilation: "NONE",
  confirmed: true,
  updatedAt: 0,
};
const airway: SecuredAirwayReference = {
  instanceId: "ET-1",
  patientId,
  definitionId: "ENDOTRACHEAL_INTUBATION",
  status: "RUNNING",
  airwayState,
};
const circulation: CirculationState = {
  patientId,
  vascularAccess: [{ interventionInstanceId: "IV-1", type: "PERIPHERAL_IV",
    resourceIds: ["PIV-1"], establishedAt: 0 }],
  hemorrhageControl: [], runningInfusions: [], updatedAt: 0,
};

function command(action: MechanicalVentilationCommand["action"], commandId: string,
  overrides: Partial<MechanicalVentilationCommand> = {}): MechanicalVentilationCommand {
  return {
    commandId,
    action,
    supportId: "VENT-1",
    patientId,
    simulationTimeSec: 0,
    ...(action === "STOP" ? {} : { settings }),
    ...(action === "START" ? { securedAirwayId: "ET-1" } : {}),
    ...overrides,
  };
}

function startedRuntime(): MechanicalVentilationRuntime {
  const runtime = new MechanicalVentilationRuntime();
  expect(runtime.execute(command("START", "START"), airway).status).toBe("APPLIED");
  return runtime;
}

function analgesicStart(drugId: AnalgesicDrugId, index = 0): AnalgesicCommand {
  const product = analgesicProductById.get(drugId)!;
  const mode = product.modes[0];
  return { commandId: `START-${drugId}-${index}`, action: "START", administrationId: `ADMIN-${drugId}-${index}`,
    patientId, drugId, simulationTimeSec: 0, mode, route: "IV", vascularAccessId: "IV-1",
    ...(mode === "BOLUS"
      ? { dose: product.referenceExposureDose, doseUnit: product.bolusDoseUnit }
      : { rate: product.maximumInfusionRate! / 2, rateUnit: product.infusionRateUnit }) };
}

function engineWithSecuredAirway(): ClinicalScenarioEngine {
  const source = new ClinicalScenarioEngine();
  source.reset(mtpReferenceFixture);
  const payload = source.captureRuntimePayload();
  const engine = new ClinicalScenarioEngine();
  engine.rehydrateRuntimePayload({
    ...payload,
    interventionInstances: [...payload.interventionInstances, {
      instanceId: "ET-1", definitionId: "ENDOTRACHEAL_INTUBATION", definitionVersion: "1.0.0",
      definitionName: "Endotrahheaalne intubatsioon", encounterId: patientId, patientId,
      status: "RUNNING", startedAt: 0, parameters: { confirmation: true }, resourceIds: [],
      sourceInterventionId: "ET-SOURCE",
    }],
    airway: { states: [airwayState], events: [] },
  });
  return engine;
}

describe("mechanical ventilation external respiratory support", () => {
  test("declares canonical VOLUME_CONTROL identity, units and reusable feature contract", () => {
    expect(mechanicalVentilationClinicalFeatureContract).toMatchObject({
      featureId: "MECHANICAL_VENTILATION", category: "VENTILATION", schemaVersion: 1,
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      physiology: { combine: "EXTERNAL_RESPIRATORY_SUPPORT_FLOOR" },
      persistence: { boundary: "RUNTIME_CHECKPOINT", detached: true },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
    });
    expect(DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION).toMatchObject({
      minimumRespiratoryRate: 1, maximumRespiratoryRate: 60, minimumFio2: 0.21, maximumFio2: 1,
    });
    expect(settings).toMatchObject({ respiratoryRateUnit: "BREATHS_MIN", tidalVolumeUnit: "ML",
      peepUnit: "CM_H2O" });
  });

  test("starts on a confirmed endotracheal airway and calculates gross minute ventilation", () => {
    const runtime = startedRuntime();
    expect(mechanicalMinuteVentilationLMin(settings)).toBe(7);
    expect(runtime.projectionsAt(0, () => ({ airwayValid: true, spontaneousRespiratoryRate: 10 }))[0])
      .toMatchObject({ mode: "VOLUME_CONTROL", lifecycle: "RUNNING", externalSupportActive: true,
        respiratoryRate: 14, tidalVolumeMl: 500, mechanicalMinuteVentilationLMin: 7,
        effectiveRespiratoryRate: 14, fio2: 0.6, peepCmH2O: 5,
        peepPhysiologicEffect: "DEFERRED_NO_GENERIC_RECRUITMENT_MODEL" });
  });

  test("applies controlled ventilation as a floor rather than summing spontaneous drive", () => {
    const runtime = startedRuntime();
    expect(runtime.projectionsAt(0, () => ({ airwayValid: true, spontaneousRespiratoryRate: 22 }))[0]
      .effectiveRespiratoryRate).toBe(22);
    expect(runtime.projectionsAt(0, () => ({ airwayValid: true, spontaneousRespiratoryRate: 0 }))[0]
      .effectiveRespiratoryRate).toBe(14);
    expect(runtime.vitalContributorsAt(0, () => ({ airwayValid: true }))).toEqual([
      expect.objectContaining({ layer: "EXTERNAL_RESPIRATORY_SUPPORT", vital: "respiratoryRate",
        operation: "TARGET", value: 14 }),
    ]);
  });

  test("preserves medication depression beneath the external respiratory floor", () => {
    const runtime = startedRuntime();
    const projection = runtime.projectionsAt(0, () => ({ airwayValid: true,
      spontaneousRespiratoryRate: 8, medicationRespiratoryDepression: 0.5 }))[0];
    expect(projection).toMatchObject({ spontaneousRespiratoryRate: 8,
      medicationRespiratoryDepression: 0.5, effectiveRespiratoryRate: 14 });
    const resolved = new VitalSignEngine().resolve({ timestamp: 0, configuration: defaultVitalSignConfiguration,
      contributors: [{ contributorId: "MED", sourceType: "CLINICAL_EFFECT", sourceId: "ANALGESIA",
        layer: "MEDICATION", vital: "respiratoryRate", operation: "TARGET", value: 8 },
      ...runtime.vitalContributorsAt(0, () => ({ airwayValid: true }))] });
    expect(resolved.state.readings.respiratoryRate.target).toBe(14);
    const reversed = new VitalSignEngine().resolve({ timestamp: 0, configuration: defaultVitalSignConfiguration,
      contributors: [...runtime.vitalContributorsAt(0, () => ({ airwayValid: true })),
        { contributorId: "MED", sourceType: "CLINICAL_EFFECT", sourceId: "ANALGESIA",
          layer: "MEDICATION", vital: "respiratoryRate", operation: "TARGET", value: 8 }] });
    expect(reversed.state).toEqual(resolved.state);
  });

  test.each(["FENTANYL", "REMIFENTANIL", "MORPHINE", "OXYCODONE"] as const)(
    "supports %s respiratory depression without mutating the opioid state", (drugId) => {
      const medications = new MedicationEngine();
      medications.executeAnalgesic(analgesicStart(drugId), circulation);
      const before = medications.snapshot();
      const depression = medications.analgesicAggregateAt(patientId, 600).respiratoryDepression;
      const runtime = startedRuntime();
      expect(depression).toBeGreaterThan(0);
      expect(runtime.projectionsAt(600, () => ({ airwayValid: true, spontaneousRespiratoryRate: 5,
        medicationRespiratoryDepression: depression }))[0]).toMatchObject({
          effectiveRespiratoryRate: 14, medicationRespiratoryDepression: depression,
        });
      runtime.execute(command("STOP", `STOP-${drugId}`, { simulationTimeSec: 600 }));
      expect(runtime.projectionsAt(600, () => ({ airwayValid: true, spontaneousRespiratoryRate: 5,
        medicationRespiratoryDepression: depression }))[0].effectiveRespiratoryRate).toBe(5);
      expect(medications.snapshot()).toEqual(before);
    },
  );

  test("combines multiple opioid depressants while preserving one external ventilation floor", () => {
    const medications = new MedicationEngine();
    (["FENTANYL", "REMIFENTANIL", "MORPHINE"] as AnalgesicDrugId[]).forEach((drugId, index) =>
      medications.executeAnalgesic(analgesicStart(drugId, index), circulation));
    const depression = medications.analgesicAggregateAt(patientId, 600).respiratoryDepression;
    const runtime = startedRuntime();
    expect(depression).toBeGreaterThan(0.65);
    expect(runtime.projectionsAt(600, () => ({ airwayValid: true, spontaneousRespiratoryRate: 2,
      medicationRespiratoryDepression: depression }))[0].effectiveRespiratoryRate).toBe(14);
    expect(runtime.snapshot()!.supports).toHaveLength(1);
  });

  test.each(["KETAMINE", "ESKETAMINE"] as const)(
    "keeps %s dissociation state independent from mechanical ventilation", (drugId) => {
      const medications = new MedicationEngine();
      medications.executeAnalgesic(analgesicStart(drugId), circulation);
      const before = medications.analgesicProjectionsAt(600);
      const runtime = startedRuntime();
      expect(runtime.projectionsAt(600, () => ({ airwayValid: true, spontaneousRespiratoryRate: 10,
        medicationRespiratoryDepression: medications.analgesicAggregateAt(patientId, 600)
          .respiratoryDepression }))[0].effectiveRespiratoryRate).toBe(14);
      expect(medications.analgesicProjectionsAt(600)).toEqual(before);
      expect(before[0].dissociation).toBeGreaterThan(0);
    },
  );

  test("is command-idempotent and rejects a second active support", () => {
    const runtime = new MechanicalVentilationRuntime();
    const start = command("START", "START");
    expect(runtime.execute(start, airway).status).toBe("APPLIED");
    expect(runtime.execute(start, airway).status).toBe("IDEMPOTENT");
    expect(runtime.execute(command("START", "START-2", { supportId: "VENT-2" }), airway))
      .toMatchObject({ status: "REJECTED", rejectionReason: "ALREADY_ACTIVE" });
    expect(runtime.snapshot()!.events.filter(item => item.eventType === "MechanicalVentilationStarted"))
      .toHaveLength(1);
  });

  test("changes settings on the same support without recreating its lifecycle", () => {
    const runtime = startedRuntime();
    const changedSettings = { ...settings, respiratoryRate: 18, tidalVolumeMl: 450, fio2: 0.8, peepCmH2O: 8 };
    const change = command("CHANGE_SETTINGS", "CHANGE", { simulationTimeSec: 60, settings: changedSettings });
    expect(runtime.execute(change).status).toBe("APPLIED");
    expect(runtime.execute(change).status).toBe("IDEMPOTENT");
    expect(runtime.snapshot()!.supports[0]).toMatchObject({ supportId: "VENT-1", startedAtSimulationTimeSec: 0,
      lastSettingsChangeAtSimulationTimeSec: 60, respiratoryRate: 18, tidalVolumeMl: 450,
      fio2: 0.8, peepCmH2O: 8 });
  });

  test("treats reordered but identical settings as a semantic no-op", () => {
    const runtime = startedRuntime();
    const reordered = { peepUnit: "CM_H2O" as const, peepCmH2O: 5, fio2: 0.6,
      tidalVolumeUnit: "ML" as const, tidalVolumeMl: 500, respiratoryRateUnit: "BREATHS_MIN" as const,
      respiratoryRate: 14, mode: "VOLUME_CONTROL" as const };
    expect(runtime.execute(command("CHANGE_SETTINGS", "SAME", { settings: reordered }))).toMatchObject({
      status: "NO_OP", state: { lastSettingsChangeAtSimulationTimeSec: 0 },
    });
  });

  test("stops idempotently and removes only the external support effect", () => {
    const runtime = startedRuntime();
    const stop = command("STOP", "STOP", { simulationTimeSec: 90 });
    expect(runtime.execute(stop).status).toBe("APPLIED");
    expect(runtime.execute(stop).status).toBe("IDEMPOTENT");
    expect(runtime.projectionsAt(90, () => ({ airwayValid: true, spontaneousRespiratoryRate: 8,
      medicationRespiratoryDepression: 0.5 }))[0]).toMatchObject({ lifecycle: "STOPPED",
        externalSupportActive: false, effectiveRespiratoryRate: 8, medicationRespiratoryDepression: 0.5 });
    expect(runtime.vitalContributorsAt(90, () => ({ airwayValid: true }))).toEqual([]);
  });

  test.each([
    [{ ...airway, airwayState: { ...airwayState, activeAirway: "NONE" } }, "MISSING_SECURED_AIRWAY"],
    [{ ...airway, airwayState: { ...airwayState, confirmed: false } }, "MISSING_SECURED_AIRWAY"],
    [{ ...airway, definitionId: "SUPRAGLOTTIC_IGEL" }, "MISSING_SECURED_AIRWAY"],
    [{ ...airway, patientId: "OTHER" }, "INVALID_PATIENT"],
  ])("fails closed for invalid secured airway reference %#", (invalid, reason) => {
    expect(new MechanicalVentilationRuntime().execute(command("START", `INVALID-${reason}`),
      invalid as SecuredAirwayReference))
      .toMatchObject({ status: "REJECTED", rejectionReason: reason });
  });

  test.each([
    [{ mode: "PRESSURE_CONTROL" }, "INVALID_MODE"],
    [{ respiratoryRate: Number.NaN }, "INVALID_RESPIRATORY_RATE"],
    [{ respiratoryRate: 0 }, "INVALID_RESPIRATORY_RATE"],
    [{ tidalVolumeMl: Number.POSITIVE_INFINITY }, "INVALID_TIDAL_VOLUME"],
    [{ tidalVolumeMl: 0 }, "INVALID_TIDAL_VOLUME"],
    [{ fio2: Number.NaN }, "INVALID_FIO2"],
    [{ fio2: 0.2 }, "INVALID_FIO2"],
    [{ fio2: 1.1 }, "INVALID_FIO2"],
    [{ peepCmH2O: Number.POSITIVE_INFINITY }, "INVALID_PEEP"],
    [{ peepCmH2O: -1 }, "INVALID_PEEP"],
    [{ respiratoryRateUnit: "PER_SEC" }, "INVALID_UNIT"],
  ])("rejects invalid settings %#", (override, reason) => {
    const invalid = { ...settings, ...override } as MechanicalVentilationSettings;
    expect(new MechanicalVentilationRuntime().execute(command("START", `INVALID-${reason}`, { settings: invalid }),
      airway)).toMatchObject({ status: "REJECTED", rejectionReason: reason });
  });

  test("stops deterministically when the secured airway is lost", () => {
    const runtime = startedRuntime();
    expect(runtime.reconcileAirway(patientId, new Set(), 120)).toEqual([
      expect.objectContaining({ eventType: "MechanicalVentilationStopped", reasonCode: "AIRWAY_LOST" }),
    ]);
    expect(runtime.projectionsAt(120, () => ({ airwayValid: false, spontaneousRespiratoryRate: 6 }))[0])
      .toMatchObject({ lifecycle: "STOPPED", airwayValid: false, externalSupportActive: false,
        effectiveRespiratoryRate: 6, stopReason: "AIRWAY_LOST" });
  });

  test("round-trips authoritative settings, lifecycle, events and idempotency", () => {
    const runtime = startedRuntime();
    runtime.execute(command("CHANGE_SETTINGS", "CHANGE", { simulationTimeSec: 60,
      settings: { ...settings, respiratoryRate: 16 } }));
    const snapshot = runtime.snapshot()!;
    const restored = new MechanicalVentilationRuntime();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(60, () => ({ airwayValid: true, spontaneousRespiratoryRate: 4 })))
      .toEqual(runtime.projectionsAt(60, () => ({ airwayValid: true, spontaneousRespiratoryRate: 4 })));
    expect(restored.execute(command("CHANGE_SETTINGS", "CHANGE", { simulationTimeSec: 60,
      settings: { ...settings, respiratoryRate: 16 } })).status).toBe("IDEMPOTENT");
  });

  test.each([
    ["opioid-depressed", { airwayValid: true, spontaneousRespiratoryRate: 5,
      medicationRespiratoryDepression: 0.7 }],
    ["apnoeic", { airwayValid: true, spontaneousRespiratoryRate: 0,
      medicationRespiratoryDepression: 0 }],
  ] as const)("round-trips a running %s patient without changing support", (_label, context) => {
    const runtime = startedRuntime();
    const snapshot = runtime.snapshot()!;
    const restored = new MechanicalVentilationRuntime();
    restored.restore(snapshot);
    expect(restored.projectionsAt(300, () => context)).toEqual(runtime.projectionsAt(300, () => context));
    expect(restored.projectionsAt(300, () => context)[0].effectiveRespiratoryRate).toBe(14);
  });

  test("round-trips stopped support while the underlying spontaneous state remains effective", () => {
    const runtime = startedRuntime();
    runtime.execute(command("STOP", "STOP-ROUNDTRIP", { simulationTimeSec: 180 }));
    const restored = new MechanicalVentilationRuntime();
    restored.restore(runtime.snapshot());
    expect(restored.snapshot()).toEqual(runtime.snapshot());
    expect(restored.projectionsAt(180, () => ({ airwayValid: true, spontaneousRespiratoryRate: 4,
      medicationRespiratoryDepression: 0.8 }))[0]).toMatchObject({ lifecycle: "STOPPED",
        externalSupportActive: false, effectiveRespiratoryRate: 4, medicationRespiratoryDepression: 0.8 });
  });

  test("keeps optional checkpoint state absent when unused", () => {
    const engine = new ClinicalScenarioEngine();
    engine.reset(mtpReferenceFixture);
    expect(engine.captureRuntimePayload()).not.toHaveProperty("mechanicalVentilation");
  });

  test("ScenarioEngine persists active ventilation and exposes detached assessment/debug state", () => {
    const engine = engineWithSecuredAirway();
    expect(engine.executeMechanicalVentilationCommand(command("START", "SCENARIO"))).toMatchObject({
      status: "APPLIED", state: { lifecycle: "RUNNING", securedAirwayId: "ET-1" },
    });
    expect(engine.getAirwayState(patientId).currentVentilation).toBe("MECHANICAL");
    expect(engine.getAssessmentSnapshot().clinicalFeatures).toContainEqual(expect.objectContaining({
      featureId: "MECHANICAL_VENTILATION", mode: "VOLUME_CONTROL", peepCmH2O: 5,
      peepPhysiologicEffect: "DEFERRED_NO_GENERIC_RECRUITMENT_MODEL",
    }));
    const payload = engine.captureRuntimePayload();
    expect(payload.mechanicalVentilation).toBeDefined();
    const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getMechanicalVentilationState()).toEqual(engine.getMechanicalVentilationState());
    const detached = restored.getMechanicalVentilationState().map(item => ({ ...item }));
    detached[0].respiratoryRate = 99;
    expect(restored.getMechanicalVentilationState()[0].respiratoryRate).toBe(14);
  });

  test("stopping ScenarioEngine support restores spontaneous state and preserves canonical evidence", () => {
    const engine = engineWithSecuredAirway();
    engine.executeMechanicalVentilationCommand(command("START", "SCENARIO"));
    expect(engine.executeMechanicalVentilationCommand(command("STOP", "SCENARIO-STOP"))).toMatchObject({
      status: "APPLIED", state: { lifecycle: "STOPPED", stopReason: "COMMAND" },
    });
    expect(engine.getAirwayState(patientId).currentVentilation).toBe("NONE");
    expect(engine.getEventLog().filter(item => item.eventType === "MechanicalVentilationStopped")).toHaveLength(1);
    expect(engine.getMechanicalVentilationState()[0].externalSupportActive).toBe(false);
  });

  test("removing the canonical secured airway stops ScenarioEngine support fail-closed", () => {
    const engine = engineWithSecuredAirway();
    engine.executeMechanicalVentilationCommand(command("START", "AIRWAY-LOSS"));
    expect(engine.stopClinicalIntervention("ET-SOURCE")).toMatchObject({ status: "CANCELLED" });
    expect(engine.getAirwayState(patientId)).toMatchObject({ activeAirway: "NONE", currentVentilation: "NONE" });
    expect(engine.getMechanicalVentilationState()[0]).toMatchObject({ lifecycle: "STOPPED",
      stopReason: "AIRWAY_LOST", airwayValid: false, externalSupportActive: false });
  });

  test("FiO2 uses existing oxygenation recovery and does not mutate spontaneous hypoxia state directly", () => {
    const fixture: GoldenFixture = { ...mtpReferenceFixture, fixtureId: "FX-HYPOXIA", patientId,
      initialState: { processType: "HYPOXIA", templateId: "HYP", oxygenationReserve: 50, spo2: 80 } };
    const initial = bootstrapHypoxiaPatientProcess(fixture,
      { processType: "HYPOXIA", templateId: "HYP", oxygenationReserve: 50, spo2: 80 });
    const unsupported = tickHypoxiaPatientProcess(initial, 60, 1);
    const roomAirVent = tickHypoxiaPatientProcess(initial, 60, 1, undefined,
      { supportId: "V", patientId, respiratoryRate: 14, tidalVolumeMl: 500,
        mechanicalMinuteVentilationLMin: 7, fio2: 0.21, peepCmH2O: 5 });
    const oxygenVent = tickHypoxiaPatientProcess(initial, 60, 1, undefined,
      { supportId: "V", patientId, respiratoryRate: 14, tidalVolumeMl: 500,
        mechanicalMinuteVentilationLMin: 7, fio2: 1, peepCmH2O: 5 });
    expect(roomAirVent.clinicalState.spo2).toBe(unsupported.clinicalState.spo2);
    expect(oxygenVent.clinicalState.spo2).toBeGreaterThan(unsupported.clinicalState.spo2);
    expect(initial.clinicalState).toMatchObject({ oxygenTherapyActive: false, spo2: 80 });
  });

  test("reuses respiratory-failure ventilation/oxygen pathways without changing spontaneous RR", () => {
    const fixture = { fixtureId: "FX-RF", patientId };
    const initial = bootstrapRespiratoryFailurePatientProcess(fixture,
      { phenotype: "MIXED", spo2: 80, respiratoryRate: 8, etco2: 70, fatigue: 60, workOfBreathing: 60 });
    const support = { supportId: "V", patientId, respiratoryRate: 14, tidalVolumeMl: 500,
      mechanicalMinuteVentilationLMin: 7, fio2: 0.6, peepCmH2O: 5 };
    const unsupported = tickRespiratoryFailurePatientProcess(initial, 60, 1);
    const ventilated = tickRespiratoryFailurePatientProcess(initial, 60, 1, undefined, support);
    expect(ventilated.clinicalState.spo2).toBeGreaterThan(unsupported.clinicalState.spo2);
    expect(ventilated.clinicalState.etco2).toBeLessThan(unsupported.clinicalState.etco2);
    expect(ventilated.clinicalState.fatigue).toBeLessThan(unsupported.clinicalState.fatigue);
    expect(ventilated.clinicalState.respiratoryRate).toBe(unsupported.clinicalState.respiratoryRate);
    expect(initial.clinicalState).toMatchObject({ ventilationMode: "NONE", oxygenSupport: false });
  });

  test("does not stack ventilator FiO2 with pre-existing oxygen therapy", () => {
    const fixture = { fixtureId: "FX-RF", patientId };
    const initial = bootstrapRespiratoryFailurePatientProcess(fixture,
      { phenotype: "HYPOXAEMIC", spo2: 80, respiratoryRate: 8, etco2: 40, fatigue: 60, workOfBreathing: 60 });
    const oxygenOn = { ...initial, clinicalState: { ...initial.clinicalState, oxygenSupport: true,
      oxygenTherapyActive: true } };
    const support = { supportId: "V", patientId, respiratoryRate: 14, tidalVolumeMl: 500,
      mechanicalMinuteVentilationLMin: 7, fio2: 0.6, peepCmH2O: 5 };
    expect(tickRespiratoryFailurePatientProcess(oxygenOn, 60, 1, undefined, support).clinicalState.spo2)
      .toBe(tickRespiratoryFailurePatientProcess(initial, 60, 1, undefined, support).clinicalState.spo2);
  });

  test("PEEP remains visible metadata and has no invented direct oxygenation effect", () => {
    const fixture = { fixtureId: "FX-RF", patientId };
    const initial = bootstrapRespiratoryFailurePatientProcess(fixture,
      { phenotype: "HYPOXAEMIC", spo2: 80, respiratoryRate: 8, fatigue: 60, workOfBreathing: 60 });
    const support = { supportId: "V", patientId, respiratoryRate: 14, tidalVolumeMl: 500,
      mechanicalMinuteVentilationLMin: 7, fio2: 0.6, peepCmH2O: 0 };
    const noPeep = tickRespiratoryFailurePatientProcess(initial, 60, 1, undefined, support);
    const highPeep = tickRespiratoryFailurePatientProcess(initial, 60, 1, undefined, { ...support, peepCmH2O: 20 });
    expect(highPeep).toEqual(noPeep);
  });
});
