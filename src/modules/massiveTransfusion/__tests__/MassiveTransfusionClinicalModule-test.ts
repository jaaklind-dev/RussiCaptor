import { MTP_REFERENCE_CONFIGURATION, type MassiveTransfusionConfiguration } from "@/models/MassiveTransfusion";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess, drainMassiveTransfusionEvidence,
  startBloodProductAdministration, tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { massiveTransfusionClinicalModule } from "../MassiveTransfusionClinicalModule";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import { MTP_PELVIC_REFERENCE_CONFIGURATION } from "@/services/exercise/CanonicalPatientDatasets";

const fresh = (patientId = "PT-MTP") => bootstrapMassiveTransfusionPatientProcess(patientId, { configuration: MTP_REFERENCE_CONFIGURATION });
const legacyPelvicConfiguration = (): MassiveTransfusionConfiguration => ({
  ...structuredClone(MTP_PELVIC_REFERENCE_CONFIGURATION), bloodProductDelivery: undefined,
});
const hemorrhage = () => bootstrapHemorrhagePatientProcess("PT-MTP", { configuration: {
  baselineBleedingRateMlMin: 500, tourniquetEfficiency: 0.9, binderEfficiency: 0.8, infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0,
  severityThresholdsMl: [500, 1000, 2000, 3000], perfusionThresholdsMl: [1000, 2000, 3000], compensationThresholdsMl: [1500, 2500],
  trendThresholdsMlMin: { worsening: 100, improving: 0 }, vitalResponsePer1000Ml: { heartRateDelta: 15, systolicBpDelta: -18, diastolicBpDelta: -10, crtDelta: 0.8 },
} });
const pelvicHemorrhage = () => bootstrapHemorrhagePatientProcess("PT-MTP", { configuration: {
  baselineBleedingRateMlMin: 140, tourniquetEfficiency: 0, binderEfficiency: 0.6, infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0,
  severityThresholdsMl: [300, 700, 1200, 1800], perfusionThresholdsMl: [600, 1100, 1700], compensationThresholdsMl: [900, 1600],
  trendThresholdsMlMin: { worsening: 80, improving: 30 }, vitalResponsePer1000Ml: { heartRateDelta: 35, systolicBpDelta: -35, diastolicBpDelta: -20, crtDelta: 2 },
} });
const binderEffect = (): ClinicalEffect => ({ effectId: "PB", effectType: "PELVIC_STABILIZATION", encounterId: "PT-MTP", patientId: "PT-MTP", timestamp: 0, sourceInterventionInstanceId: "PB", parameters: {} });
const vital = (process: { outputs: { vitalContributions?: readonly { vital: string; value: number }[] } }, name: string) => process.outputs.vitalContributions?.find(item => item.vital === name)?.value ?? 0;

describe("WP-47 massive transfusion clinical module", () => {
  test("publishes a deterministic frozen module without changing historical modules", () => {
    expect(Object.isFrozen(massiveTransfusionClinicalModule)).toBe(true);
    expect(massiveTransfusionClinicalModule.registrations).toMatchObject({ patientProcesses: ["MASSIVE_TRANSFUSION"],
      interventions: ["MTP_ACTIVATION", "PLASMA_ADMINISTRATION", "PLATELET_ADMINISTRATION", "RBC_ADMINISTRATION"] });
    expect(massiveTransfusionClinicalModule.moduleHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("activation is separate from administration and idempotent", () => {
    const activated = activateMassiveTransfusion(fresh(), "ACT-1");
    expect(activated.clinicalState.activated).toBe(true); expect(activated.clinicalState.transfusedVolumeMl).toBe(0);
    expect(activateMassiveTransfusion(activated, "ACT-1")).toEqual(activated);
    expect(drainMassiveTransfusionEvidence(activated).evidence.map(item => item.eventType)).toEqual(["MTP_ACTIVATED"]);
  });

  test.each(["RBC", "PLASMA", "PLATELETS"] as const)("%s administration consumes finite inventory and completes over time", product => {
    const activated = activateMassiveTransfusion(fresh(), "ACT"); const started = startBloodProductAdministration(activated, `GIVE-${product}`, product, 1);
    expect(started.clinicalState.inventory[product]).toBe(MTP_REFERENCE_CONFIGURATION.initialInventory[product] - 1);
    const midway = tickMassiveTransfusionPatientProcess(started, 60); expect(midway.clinicalState.administrations[0].state).toBe("RUNNING");
    const complete = tickMassiveTransfusionPatientProcess(midway, 180); expect(complete.clinicalState.administrations[0].state).toBe("COMPLETED");
    expect(complete.clinicalState.administeredUnits[product]).toBe(1);
  });

  test("RBC changes oxygen capacity while plasma and platelets do not", () => {
    const activated = activateMassiveTransfusion(fresh(), "ACT");
    const rbc = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activated, "R", "RBC", 1), 180);
    const plasma = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activated, "P", "PLASMA", 1), 180);
    const platelets = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activated, "T", "PLATELETS", 1), 180);
    expect(rbc.clinicalState.oxygenCarryingCapacity).toBe(1); expect(plasma.clinicalState.oxygenCarryingCapacity).toBe(0);
    expect(platelets.clinicalState.oxygenCarryingCapacity).toBe(0); expect(plasma.clinicalState.coagulationSupport).toBe(1);
  });

  test("administration identity prevents duplicate product, volume and evidence", () => {
    const activated = activateMassiveTransfusion(fresh(), "ACT"); const first = startBloodProductAdministration(activated, "RBC-1", "RBC", 1);
    expect(startBloodProductAdministration(first, "RBC-1", "RBC", 1)).toEqual(first);
    expect(first.clinicalState.inventory.RBC).toBe(5); expect(first.clinicalState.administrations).toHaveLength(1);
  });

  test("inventory cannot become negative", () => {
    const activated = activateMassiveTransfusion(fresh(), "ACT");
    expect(() => startBloodProductAdministration(activated, "TOO-MUCH", "PLATELETS", 2)).toThrow("BLOOD_PRODUCT_UNAVAILABLE");
    expect(activated.clinicalState.inventory.PLATELETS).toBe(1);
  });

  test("platelet availability is optional while RBC and plasma remain functional", () => {
    const configuration = {
      ...structuredClone(MTP_REFERENCE_CONFIGURATION),
      initialInventory: { ...MTP_REFERENCE_CONFIGURATION.initialInventory, PLATELETS: 0 },
    };
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration }), "ACT");
    expect(() => startBloodProductAdministration(process, "NO-PLATELETS", "PLATELETS", 1)).toThrow("BLOOD_PRODUCT_UNAVAILABLE");
    expect(process.clinicalState.inventory.PLATELETS).toBe(0);
    expect(process.pendingEvidence).toHaveLength(1);

    process = startBloodProductAdministration(process, "RBC", "RBC", 1);
    process = startBloodProductAdministration(process, "PLASMA", "PLASMA", 1);
    process = tickMassiveTransfusionPatientProcess(process, 180);
    expect(process.clinicalState.administeredUnits).toEqual({ RBC: 1, PLASMA: 1, PLATELETS: 0 });
    expect(process.clinicalState.inventory).toEqual({ RBC: 5, PLASMA: 5, PLATELETS: 0 });
    expect(process.clinicalState.transfusedVolumeMl).toBe(550);
    expect(process.clinicalState.oxygenCarryingCapacity).toBe(1);
  });

  test("binder plus RBC and plasma improves current physiology without platelets", () => {
    const before = tickHemorrhagePatientProcess(pelvicHemorrhage(), 300).process;
    const after = tickHemorrhagePatientProcess(setHemorrhageEffects(before, [binderEffect()]), 60).process;
    const configuration = {
      ...legacyPelvicConfiguration(),
      initialInventory: { ...MTP_PELVIC_REFERENCE_CONFIGURATION.initialInventory, PLATELETS: 0 },
    };
    let mtp = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration }), "ACT");
    mtp = startBloodProductAdministration(mtp, "RBC", "RBC", 1);
    mtp = startBloodProductAdministration(mtp, "PLASMA", "PLASMA", 1);
    mtp = tickMassiveTransfusionPatientProcess(mtp, 60);

    expect(mtp.clinicalState.transfusedVolumeMl - after.clinicalState.bleedingRateMlMin).toBe(144);
    expect(after.clinicalState.cumulativeLossMl - mtp.clinicalState.transfusedVolumeMl).toBe(556);
    expect(vital(after, "systolicBp") + vital(mtp, "systolicBp")).toBeGreaterThan(vital(before, "systolicBp"));
    expect(mtp.pendingEvidence.some(item => String(item.details.product) === "PLATELETS")).toBe(false);
  });

  test("zero platelet availability creates no mandatory completion or evidence gate", () => {
    const configuration = {
      ...structuredClone(MTP_REFERENCE_CONFIGURATION),
      initialInventory: { ...MTP_REFERENCE_CONFIGURATION.initialInventory, PLATELETS: 0 },
    };
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration }), "ACT");
    process = startBloodProductAdministration(process, "RBC", "RBC", 1);
    process = startBloodProductAdministration(process, "PLASMA", "PLASMA", 1);
    process = tickMassiveTransfusionPatientProcess(process, 180);
    const evidence = drainMassiveTransfusionEvidence(process).evidence;

    expect(process.clinicalState.administrations.every(item => item.state === "COMPLETED")).toBe(true);
    expect(evidence.filter(item => item.eventType === "BLOOD_PRODUCT_ADMINISTRATION_COMPLETED")).toHaveLength(2);
    expect(evidence.some(item => String(item.details.product) === "PLATELETS")).toBe(false);
    expect(process.state).not.toBe("Resolved");
  });

  test("ongoing hemorrhage remains historical and opposes replacement contributors", () => {
    const bleeding = tickHemorrhagePatientProcess(hemorrhage(), 300).process;
    const activated = activateMassiveTransfusion(fresh(), "ACT");
    const transfused = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activated, "RBC", "RBC", 2), 360);
    expect(bleeding.clinicalState.cumulativeLossMl).toBe(2500); expect(transfused.clinicalState.transfusedVolumeMl).toBe(600);
    const hemorrhageSbp = bleeding.outputs.vitalContributions?.find(item => item.vital === "systolicBp")?.value ?? 0;
    const mtpSbp = transfused.outputs.vitalContributions?.find(item => item.vital === "systolicBp")?.value ?? 0;
    expect(hemorrhageSbp).toBeLessThan(0); expect(mtpSbp).toBeGreaterThan(0); expect(Math.abs(mtpSbp)).toBeLessThan(Math.abs(hemorrhageSbp));
  });

  test("diagnostic balance matrix follows inflow minus hemorrhage outflow", () => {
    const before = tickHemorrhagePatientProcess(pelvicHemorrhage(), 300).process;
    expect(before.clinicalState.cumulativeLossMl).toBe(700);

    const oneRbc = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(
      activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration: legacyPelvicConfiguration() }), "ACT-A"), "RBC-A", "RBC", 1), 60);
    const negativeLoss = tickHemorrhagePatientProcess(before, 60).process;
    expect(oneRbc.clinicalState.transfusedVolumeMl - 140).toBe(-40);
    expect(negativeLoss.clinicalState.cumulativeLossMl - oneRbc.clinicalState.transfusedVolumeMl).toBe(740);

    const equalConfiguration = {
      ...legacyPelvicConfiguration(),
      products: {
        ...structuredClone(MTP_PELVIC_REFERENCE_CONFIGURATION.products),
        RBC: { ...MTP_PELVIC_REFERENCE_CONFIGURATION.products.RBC, administrationRateMlMin: 140 },
      },
    };
    const equal = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(
      activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration: equalConfiguration }), "ACT-B"), "RBC-B", "RBC", 1), 60);
    expect(equal.clinicalState.transfusedVolumeMl - 140).toBe(0);

    let positive = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration: legacyPelvicConfiguration() }), "ACT-C");
    positive = startBloodProductAdministration(positive, "RBC-C", "RBC", 1);
    positive = startBloodProductAdministration(positive, "PLASMA-C", "PLASMA", 1);
    positive = startBloodProductAdministration(positive, "PLATELETS-C", "PLATELETS", 1);
    positive = tickMassiveTransfusionPatientProcess(positive, 60);
    expect(positive.clinicalState.transfusedVolumeMl - 140).toBe(160);
    expect(negativeLoss.clinicalState.cumulativeLossMl).toBe(840);
  });

  test("binder plus active MTP makes current deficit and vital contributors recover without erasing historical loss", () => {
    const before = tickHemorrhagePatientProcess(pelvicHemorrhage(), 300).process;
    const controlled = setHemorrhageEffects(before, [binderEffect()]);
    const after = tickHemorrhagePatientProcess(controlled, 60).process;
    let mtp = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-MTP", { configuration: legacyPelvicConfiguration() }), "ACT");
    mtp = startBloodProductAdministration(mtp, "RBC", "RBC", 1);
    mtp = startBloodProductAdministration(mtp, "PLASMA", "PLASMA", 1);
    mtp = startBloodProductAdministration(mtp, "PLATELETS", "PLATELETS", 1);
    mtp = tickMassiveTransfusionPatientProcess(mtp, 60);

    expect(after.clinicalState.bleedingRateMlMin).toBe(56);
    expect(mtp.clinicalState.transfusedVolumeMl - after.clinicalState.bleedingRateMlMin).toBe(244);
    expect(after.clinicalState.cumulativeLossMl).toBe(756);
    expect(after.clinicalState.cumulativeLossMl - mtp.clinicalState.transfusedVolumeMl).toBe(456);
    expect(vital(after, "systolicBp") + vital(mtp, "systolicBp")).toBeCloseTo(-15.96, 6);
    expect(vital(after, "heartRate") + vital(mtp, "heartRate")).toBeCloseTo(15.96, 6);
    expect(vital(after, "systolicBp") + vital(mtp, "systolicBp")).toBeGreaterThan(vital(before, "systolicBp"));
  });

  test("snapshot round-trip preserves activation, progress, resources and determinism", () => {
    const running = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activateMassiveTransfusion(fresh(), "ACT"), "RBC", "RBC", 2), 90);
    const restored = structuredClone(running);
    expect(tickMassiveTransfusionPatientProcess(restored, 90)).toEqual(tickMassiveTransfusionPatientProcess(running, 90));
  });

  test("patients remain isolated", () => {
    const a = tickMassiveTransfusionPatientProcess(startBloodProductAdministration(activateMassiveTransfusion(fresh("A"), "A-ACT"), "A-RBC", "RBC", 1), 180);
    const b = fresh("B"); expect(a.encounterId).toBe("A"); expect(b.encounterId).toBe("B");
    expect(a.clinicalState.transfusedVolumeMl).toBe(300); expect(b.clinicalState.transfusedVolumeMl).toBe(0); expect(b.clinicalState.inventory.RBC).toBe(6);
  });

  test("canonical lifecycle records activation/start/completion and rehydrates an in-progress administration", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(mtpFixture());
    engine.dispatch(action(1, 0, "MTP_ACTIVATION", "MTP-ACT"));
    engine.dispatch(action(2, 0, "RBC_ADMINISTRATION", "MTP-RBC", { units: 2 }));
    engine.advanceTo(60); engine.dispatch(tickEvent(3, 60, 1));
    const before = engine.getPatientProcesses().find(item => item.processType === "MASSIVE_TRANSFUSION");
    expect(before?.outputs.runtimeContributions?.transfusedVolumeMl).toBe(100);
    const payload = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(payload);
    engine.advanceTo(360); engine.dispatch(tickEvent(4, 360, 5)); restored.advanceTo(360); restored.dispatch(tickEvent(4, 360, 5));
    expect(restored.captureRuntimePayload()).toEqual(engine.captureRuntimePayload());
    expect(engine.getEventLog().map(item => item.eventType)).toEqual(expect.arrayContaining([
      "MTP_ACTIVATED", "BLOOD_PRODUCT_ADMINISTRATION_STARTED", "BLOOD_PRODUCT_ADMINISTRATION_COMPLETED",
    ]));
  });
});

function mtpFixture(): GoldenFixture {
  return { fixtureId: "FX-WP47", fixtureType: "PROCESS", patientId: "PT-MTP", seed: 47, clockState: "RUNNING", ownershipVersion: 1,
    loadedModules: ["MASSIVE_TRANSFUSION_V1"], activeResources: {}, initialState: {
      processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 35, co2GainPerMin: 0,
      massiveTransfusion: { configuration: MTP_REFERENCE_CONFIGURATION },
    } };
}
function action(step: number, offsetSec: number, actionId: string, eventId: string, payload: unknown = {}): GoldenInputEvent {
  return { sequenceId: "WP47", step, offsetSec, eventType: "ACTION", actor: "EXCON", target: "PT-MTP", eventId, actionId, result: "APPLIED", payload };
}
function tickEvent(step: number, offsetSec: number, tickMin: number): GoldenInputEvent {
  return { sequenceId: "WP47", step, offsetSec, eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-MTP", eventId: `TICK-${step}`, result: "APPLIED", payload: { tickMin } };
}
