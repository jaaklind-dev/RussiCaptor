import type { CirculationState } from "@/models/CirculationState";
import type { AnalgesicCommand, AnalgesicDrugId } from "@/models/AnalgesiaMedication";
import type { GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture, pressureDependentHemorrhageFixture } from "@/services/exercise/CanonicalPatientDatasets";
import {
  AnalgesiaRuntime,
  combineAnalgesicEffects,
  deliveredAnalgesicDoseAt,
  normalizedAnalgesicExposureAt,
} from "@/services/runtime/medication/AnalgesiaRuntime";
import {
  ANALGESIC_PRODUCT_CONFIGURATIONS,
  analgesicClinicalFeatureContracts,
  analgesicProductById,
  canonicalAnalgesicDrugId,
} from "@/services/runtime/medication/AnalgesicProducts";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";

const patientId = "PT-PELVIC-001";
const circulation: CirculationState = {
  patientId,
  vascularAccess: [
    { interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["PIV-1"], establishedAt: 0 },
    { interventionInstanceId: "IO-1", type: "IO", resourceIds: ["IO-1"], establishedAt: 0 },
  ],
  hemorrhageControl: [], runningInfusions: [], updatedAt: 0,
};

const config = (drugId: AnalgesicDrugId) => analgesicProductById.get(drugId)!;

function start(drugId: AnalgesicDrugId | "DOLMEN" = "FENTANYL", overrides: Partial<AnalgesicCommand> = {}): AnalgesicCommand {
  const canonical = canonicalAnalgesicDrugId(drugId) as AnalgesicDrugId;
  const product = config(canonical);
  const mode = product.modes[0];
  return {
    commandId: `START-${drugId}`,
    action: "START",
    administrationId: `ADMIN-${drugId}`,
    patientId,
    drugId,
    simulationTimeSec: 0,
    mode,
    route: "IV",
    vascularAccessId: "IV-1",
    ...(mode === "BOLUS"
      ? { dose: product.referenceExposureDose, doseUnit: product.bolusDoseUnit }
      : { rate: product.maximumInfusionRate! / 2, rateUnit: product.infusionRateUnit }),
    ...overrides,
  };
}

const tick = (time: number, target = patientId): GoldenInputEvent => ({
  sequenceId: "ANALGESIA", step: time, offsetSec: time, eventType: "ENGINE_TICK", actor: "ENGINE",
  target, eventId: `ANALGESIA-TICK-${target}-${time}`, result: "SUCCESS", payload: { tickMin: 1 },
});

function engineWithAccess(fixture = mtpReferenceFixture): { engine: ClinicalScenarioEngine; patient: string; accessId: string } {
  const patient = fixture.patientId!;
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.scheduleIntervention({ interventionId: `PIV-ANALGESIA-${patient}`, patientId: patient,
    resourceId: "PIV-1", action: "APPLY", timestamp: 0, definitionId: "PERIPHERAL_IV_ACCESS",
    parameters: { location: "arm", gauge: 18, attempts: 1 } });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
  engine.advanceTo(180);
  engine.dispatch(tick(180, patient));
  return { engine, patient, accessId: engine.getCirculationState(patient).vascularAccess[0].interventionInstanceId };
}

const expectedProfiles: readonly [AnalgesicDrugId, string, string][] = [
  ["FENTANYL", "OPIOID", "Fentanyl"],
  ["REMIFENTANIL", "OPIOID", "Remifentanil"],
  ["KETAMINE", "DISSOCIATIVE_ANALGESIC", "Ketamine"],
  ["PARACETAMOL", "NON_OPIOID_ANALGESIC", "Paracetamol"],
  ["ESKETAMINE", "DISSOCIATIVE_ANALGESIC", "Esketamine"],
  ["MORPHINE", "OPIOID", "Morphine"],
  ["OXYCODONE", "OPIOID", "Oxycodone"],
  ["KETOPROFEN", "NSAID", "Ketoprofen"],
  ["DEXKETOPROFEN", "NSAID", "Dexketoprofen (Dolmen)"],
];

describe("generic analgesia/CNS/respiratory medication Runtime", () => {
  test.each(expectedProfiles)("registers canonical %s as %s", (drugId, drugClass, displayName) => {
    expect(config(drugId)).toMatchObject({ schemaVersion: 1, drugId, drugClass, displayName });
    expect(analgesicClinicalFeatureContracts.find(item => item.featureId === drugId)).toMatchObject({
      category: "ANALGESIC", determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
    });
  });

  test.each(expectedProfiles)("administers %s through the shared Runtime", (drugId) => {
    const runtime = new AnalgesiaRuntime();
    const result = runtime.execute(start(drugId), circulation);
    expect(result).toMatchObject({ status: "APPLIED", state: { drugId, patientId, lifecycle: "RUNNING" } });
    expect(runtime.projectionsAt(0)[0]).toMatchObject({ drugId, baselinePainIntensity: 1 });
  });

  test.each(expectedProfiles)("rejects invalid %s administration without dose or effect", (drugId) => {
    const product = config(drugId);
    const invalid = product.modes[0] === "BOLUS"
      ? start(drugId, { dose: 0 })
      : start(drugId, { rate: 0 });
    const runtime = new AnalgesiaRuntime();
    expect(runtime.execute(invalid, circulation)).toMatchObject({ status: "REJECTED",
      rejectionReason: product.modes[0] === "BOLUS" ? "INVALID_DOSE" : "INVALID_RATE" });
    expect(runtime.projectionsAt(product.onsetDurationSec)).toEqual([]);
  });

  test.each(expectedProfiles)("models deterministic onset and offset for %s", (drugId) => {
    const product = config(drugId);
    const runtime = new AnalgesiaRuntime();
    const command = start(drugId);
    runtime.execute(command, circulation);
    const onset = runtime.projectionsAt(product.onsetDurationSec)[0];
    expect(onset.normalizedExposure).toBeGreaterThan(0);
    expect(onset.analgesia).toBeGreaterThan(0);
    if (command.mode === "INFUSION") {
      runtime.execute({ ...command, action: "STOP", commandId: `STOP-${drugId}`,
        simulationTimeSec: product.onsetDurationSec, mode: undefined, route: undefined,
        vascularAccessId: undefined, rate: undefined, rateUnit: undefined });
    }
    expect(runtime.projectionsAt(product.onsetDurationSec + product.effectHalfLifeSec)[0].normalizedExposure)
      .toBeLessThan(onset.normalizedExposure);
  });

  test.each(expectedProfiles)("round-trips %s without changing effect", (drugId) => {
    const runtime = new AnalgesiaRuntime();
    runtime.execute(start(drugId), circulation);
    runtime.advanceTo(90);
    const snapshot = runtime.snapshot()!;
    const restored = new AnalgesiaRuntime();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(600)).toEqual(runtime.projectionsAt(600));
    expect(restored.aggregateAt(patientId, 600)).toEqual(runtime.aggregateAt(patientId, 600));
  });

  test("keeps DOLMEN as an input/display alias of canonical DEXKETOPROFEN", () => {
    const runtime = new AnalgesiaRuntime();
    expect(canonicalAnalgesicDrugId("DOLMEN")).toBe("DEXKETOPROFEN");
    expect(runtime.execute(start("DOLMEN"), circulation)).toMatchObject({ status: "APPLIED",
      state: { drugId: "DEXKETOPROFEN" } });
    expect(runtime.projectionsAt(1200)[0]).toMatchObject({ drugId: "DEXKETOPROFEN",
      displayName: "Dexketoprofen (Dolmen)", aliases: ["DOLMEN"] });
    expect(ANALGESIC_PRODUCT_CONFIGURATIONS.some(item => item.drugId === ("DOLMEN" as AnalgesicDrugId))).toBe(false);
  });

  test("rejects unknown products, units, modes, routes and invalid dose/rate", () => {
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { drugId: "UNKNOWN" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "UNKNOWN_DRUG" });
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { doseUnit: "MG" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_UNIT" });
    expect(new AnalgesiaRuntime().execute(start("MORPHINE", { mode: "INFUSION", rate: 1, rateUnit: "MG_H" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_MODE" });
    expect(new AnalgesiaRuntime().execute(start("PARACETAMOL", { route: "IO", vascularAccessId: "IO-1" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_ROUTE" });
    expect(new AnalgesiaRuntime().execute(start("MORPHINE", { dose: 0 }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_DOSE" });
    expect(new AnalgesiaRuntime().execute(start("REMIFENTANIL", { rate: 0 }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_RATE" });
  });

  test("fails closed for missing, wrong-patient and route-mismatched vascular access", () => {
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { vascularAccessId: "NONE" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { patientId: "OTHER" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_PATIENT" });
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { route: "IO", vascularAccessId: "IV-1" }), circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_ROUTE" });
    expect(new AnalgesiaRuntime().execute(start("FENTANYL", { route: "IO", vascularAccessId: "IO-1" }), circulation))
      .toMatchObject({ status: "APPLIED", state: { route: "IO" } });
  });

  test("delivers bolus deterministically with onset, exact completion and residual offset", () => {
    const runtime = new AnalgesiaRuntime();
    runtime.execute(start("FENTANYL"), circulation);
    const state = runtime.snapshot()!.administrations[0];
    expect(deliveredAnalgesicDoseAt(state, 30, config("FENTANYL"))).toBe(50);
    expect(normalizedAnalgesicExposureAt(state, 30, config("FENTANYL"))).toBe(0.078125);
    runtime.advanceTo(60);
    expect(runtime.projectionsAt(60)[0]).toMatchObject({ lifecycle: "COMPLETED", deliveredDose: 100 });
    expect(runtime.projectionsAt(1920)[0].normalizedExposure).toBeCloseTo(0.5, 5);
    runtime.advanceTo(10_000);
    expect(runtime.projectionsAt(10_000)[0].deliveredDose).toBe(100);
  });

  test("supports infusion rate changes, stop, residual decay and command idempotency", () => {
    const runtime = new AnalgesiaRuntime();
    const initial = start("REMIFENTANIL", { rate: 10, rateUnit: "MCG_MIN" });
    expect(runtime.execute(initial, circulation).status).toBe("APPLIED");
    expect(runtime.execute(initial, circulation).status).toBe("IDEMPOTENT");
    runtime.advanceTo(60);
    const change: AnalgesicCommand = { ...initial, commandId: "CHANGE-REMI", action: "CHANGE_RATE",
      simulationTimeSec: 60, rate: 20 };
    expect(runtime.execute(change).status).toBe("APPLIED");
    expect(runtime.execute(change).status).toBe("IDEMPOTENT");
    runtime.advanceTo(120);
    expect(runtime.projectionsAt(120)[0].deliveredDose).toBe(30);
    const stopCommand: AnalgesicCommand = { ...initial, commandId: "STOP-REMI", action: "STOP",
      simulationTimeSec: 120, mode: undefined, route: undefined, vascularAccessId: undefined,
      rate: undefined, rateUnit: undefined };
    expect(runtime.execute(stopCommand).status).toBe("APPLIED");
    expect(runtime.execute(stopCommand).status).toBe("IDEMPOTENT");
    expect(runtime.projectionsAt(300)[0].normalizedExposure).toBeCloseTo(
      runtime.projectionsAt(120)[0].normalizedExposure / 2, 5);
    expect(runtime.snapshot()!.events.filter(item => item.commandId === "START-REMIFENTANIL")).toHaveLength(1);
    expect(runtime.snapshot()!.events.filter(item => item.commandId === "CHANGE-REMI")).toHaveLength(1);
    expect(runtime.snapshot()!.events.filter(item => item.commandId === "STOP-REMI")).toHaveLength(1);
  });

  test("distinguishes rapid remifentanil offset from longer fentanyl and morphine persistence", () => {
    const effectAfterHalfHour = (drugId: AnalgesicDrugId) => {
      const runtime = new AnalgesiaRuntime(); runtime.execute(start(drugId), circulation);
      if (drugId === "REMIFENTANIL") runtime.execute({ ...start(drugId), commandId: "STOP-REMI-PROFILE",
        action: "STOP", simulationTimeSec: 60, mode: undefined, route: undefined,
        vascularAccessId: undefined, rate: undefined, rateUnit: undefined });
      return runtime.projectionsAt(3600)[0].normalizedExposure;
    };
    expect(effectAfterHalfHour("REMIFENTANIL")).toBeLessThan(effectAfterHalfHour("FENTANYL"));
    expect(effectAfterHalfHour("FENTANYL")).toBeLessThan(effectAfterHalfHour("MORPHINE"));
  });

  test("keeps paracetamol and NSAIDs free of respiratory, sedation and direct hemodynamic effects", () => {
    for (const drugId of ["PARACETAMOL", "KETOPROFEN", "DEXKETOPROFEN"] as const) {
      const runtime = new AnalgesiaRuntime(); runtime.execute(start(drugId), circulation);
      const projection = runtime.projectionsAt(config(drugId).onsetDurationSec)[0];
      expect(projection.analgesia).toBeGreaterThan(0);
      expect(projection).toMatchObject({ sedation: 0, respiratoryDepression: 0, dissociation: 0,
        sympatheticEffect: 0, hemodynamicDepression: 0 });
    }
  });

  test("models ketamine and esketamine as distinct dissociatives with much lower respiratory depression", () => {
    const values = Object.fromEntries(["FENTANYL", "KETAMINE", "ESKETAMINE"].map(drugId => {
      const runtime = new AnalgesiaRuntime(); runtime.execute(start(drugId as AnalgesicDrugId), circulation);
      return [drugId, runtime.projectionsAt(config(drugId as AnalgesicDrugId).onsetDurationSec)[0]];
    }));
    expect(values.KETAMINE.drugId).not.toBe(values.ESKETAMINE.drugId);
    expect(values.KETAMINE.dissociation).toBeGreaterThan(0.5);
    expect(values.ESKETAMINE.dissociation).toBeGreaterThan(0.5);
    expect(values.KETAMINE.respiratoryDepression).toBeLessThan(values.FENTANYL.respiratoryDepression);
    expect(values.ESKETAMINE.respiratoryDepression).toBeLessThan(values.FENTANYL.respiratoryDepression);
  });

  test("combines each effect domain by bounded order-independent union", () => {
    const first = { analgesia: 0.6, sedation: 0.4, respiratoryDepression: 0.2, dissociation: 0,
      sympatheticEffect: 0, hemodynamicDepression: 0.1, antiInflammatoryAnalgesia: 0 };
    const second = { analgesia: 0.5, sedation: 0, respiratoryDepression: 0, dissociation: 0.8,
      sympatheticEffect: 0.4, hemodynamicDepression: 0, antiInflammatoryAnalgesia: 0.5 };
    expect(combineAnalgesicEffects([first, second])).toEqual(combineAnalgesicEffects([second, first]));
    expect(combineAnalgesicEffects([first, second])).toMatchObject({ analgesia: 0.8,
      sedation: 0.4, respiratoryDepression: 0.2, dissociation: 0.8 });
    expect(Object.values(combineAnalgesicEffects([first, second])).every(value => value >= 0 && value <= 1)).toBe(true);
  });

  test("combines opioid, dissociative and non-opioid administrations without overwriting", () => {
    const runtime = new AnalgesiaRuntime();
    (["FENTANYL", "PARACETAMOL", "KETOPROFEN", "KETAMINE"] as AnalgesicDrugId[]).forEach((drugId, index) =>
      runtime.execute(start(drugId, { commandId: `MIX-${index}`, administrationId: `MIX-${drugId}` }), circulation));
    const aggregate = runtime.aggregateAt(patientId, 1800);
    expect(aggregate).toMatchObject({ baselinePainIntensity: 1 });
    expect(aggregate.currentPainIntensity).toBeGreaterThanOrEqual(0);
    expect(aggregate.currentPainIntensity).toBeLessThan(1);
    expect(aggregate.respiratoryDepression).toBeGreaterThan(0);
    expect(aggregate.dissociation).toBeGreaterThan(0);
    expect(aggregate.antiInflammatoryAnalgesia).toBeGreaterThan(0);
    expect(runtime.snapshot()!.administrations).toHaveLength(4);
  });

  test("uses only generic medication vital contributors and never writes SpO2 directly", () => {
    const runtime = new AnalgesiaRuntime(); runtime.execute(start("FENTANYL"), circulation);
    const contributors = runtime.vitalContributorsAt(120);
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "MEDICATION", vital: "respiratoryRate" }));
    expect(contributors).toContainEqual(expect.objectContaining({ layer: "MEDICATION", vital: "gcs" }));
    expect(contributors.some(item => item.vital === "spo2")).toBe(false);
    expect(contributors.every(item => item.sourceId === "ANALGESIA")).toBe(true);
  });

  test("adds bounded ketamine sympathetic contributors without treating it as norepinephrine", () => {
    const runtime = new AnalgesiaRuntime(); runtime.execute(start("KETAMINE"), circulation);
    const contributors = runtime.vitalContributorsAt(60);
    expect(contributors).toContainEqual(expect.objectContaining({ vital: "systolicBp", operation: "DELTA" }));
    expect(contributors).toContainEqual(expect.objectContaining({ vital: "heartRate", operation: "DELTA" }));
    expect(contributors.every(item => item.sourceId !== "NOREPINEPHRINE")).toBe(true);
  });

  test("keeps optional analgesia persistence absent when unused", () => {
    const snapshot = new MedicationEngine().snapshot();
    expect(snapshot).not.toHaveProperty("analgesia");
    expect(JSON.stringify(snapshot)).not.toContain("ANALGESIA");
  });

  test("MedicationEngine preserves independent norepinephrine, fluid, TXA and analgesia branches", () => {
    const engine = new MedicationEngine();
    engine.executeNorepinephrine({ commandId: "NE", action: "START", infusionId: "NE-1", patientId,
      simulationTimeSec: 0, doseMicrogramsPerKgMin: 0.1, unit: "MCG_KG_MIN", vascularAccessId: "IV-1" }, circulation);
    engine.executeFluidTherapy({ commandId: "RINGER", action: "START", administrationId: "RINGER-1", patientId,
      fluidType: "RINGER", simulationTimeSec: 0, mode: "INFUSION", rateMlHour: 500,
      rateUnit: "ML_H", vascularAccessId: "IV-1" }, circulation);
    engine.executeTranexamicAcid({ commandId: "TXA", action: "START", regimenId: "TXA-1", patientId,
      simulationTimeSec: 0, vascularAccessId: "IV-1" }, circulation);
    engine.executeAnalgesic(start("FENTANYL"), circulation);
    const snapshot = engine.snapshot();
    expect(snapshot).toHaveProperty("norepinephrine");
    expect(snapshot).toHaveProperty("fluidTherapy");
    expect(snapshot).toHaveProperty("tranexamicAcid");
    expect(snapshot).toHaveProperty("analgesia");
    const restored = new MedicationEngine(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
  });

  test("Scenario Runtime publishes assessment/debug state and round-trips one canonical branch", () => {
    const { engine, patient, accessId } = engineWithAccess();
    const command = start("FENTANYL", { patientId: patient, vascularAccessId: accessId,
      simulationTimeSec: 180, commandId: "SCENARIO-FENTANYL", administrationId: "SCENARIO-FENTANYL" });
    expect(engine.executeAnalgesicCommand(command).status).toBe("APPLIED");
    expect(engine.executeAnalgesicCommand(command).status).toBe("IDEMPOTENT");
    expect(engine.getEventLog().filter(item => item.eventType === "AnalgesicAdministrationStarted")).toHaveLength(1);
    engine.advanceTo(300); engine.dispatch(tick(300, patient));
    expect(engine.getAssessmentSnapshot().clinicalFeatures).toContainEqual(expect.objectContaining({
      featureId: "ANALGESIA", drugId: "FENTANYL", drugClass: "OPIOID",
    }));
    expect(getPatientResourceDebugSnapshot(patient).medicationState?.clinicalFeatures)
      .toContainEqual(expect.objectContaining({ featureId: "ANALGESIA", drugId: "FENTANYL" }));
    const payload = engine.captureRuntimePayload();
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getAnalgesicState()).toEqual(engine.getAnalgesicState());
    expect(restored.getRuntimeState().vitalSignState).toEqual(engine.getRuntimeState().vitalSignState);
  });

  test("analgesia changes derived pain/CNS/respiration without modifying injury or source control", () => {
    const treated = engineWithAccess(pressureDependentHemorrhageFixture);
    const beforeProcess = treated.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    const beforeConfiguration = structuredClone(beforeProcess.configuration);
    const beforeControl = beforeProcess.clinicalState.pelvicStabilizationState;
    const beforeBloodLoss = beforeProcess.clinicalState.cumulativeLossMl;
    treated.engine.executeAnalgesicCommand(start("FENTANYL", { patientId: treated.patient,
      vascularAccessId: treated.accessId, simulationTimeSec: 180, administrationId: "PELVIC-FENTANYL" }));
    const afterProcess = treated.engine.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE")!;
    expect(afterProcess.configuration).toEqual(beforeConfiguration);
    expect(afterProcess.clinicalState.pelvicStabilizationState).toEqual(beforeControl);
    expect(afterProcess.clinicalState.cumulativeLossMl).toBe(beforeBloodLoss);
    expect(treated.engine.getAnalgesicState()[0].currentPainIntensity).toBeLessThanOrEqual(1);
  });

  test("rejects stale Scenario commands and leaves the canonical event log unchanged", () => {
    const { engine, patient, accessId } = engineWithAccess();
    const before = engine.getEventLog();
    expect(engine.executeAnalgesicCommand(start("MORPHINE", { patientId: patient, vascularAccessId: accessId,
      simulationTimeSec: 179 })).rejectionReason).toBe("STALE_SIMULATION_TIME");
    expect(engine.getEventLog()).toEqual(before);
  });
});
