import { MTP_REFERENCE_CONFIGURATION, type MassiveTransfusionConfiguration, type MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, administerMtpCalcium, bootstrapMassiveTransfusionPatientProcess,
  drainMassiveTransfusionEvidence, startBloodProductAdministration, tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { assessMtpCalcium } from "@/services/runtime/assessment/MtpCalciumAssessment";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { getCanonicalPatientRuntimeSnapshot } from "@/services/RuntimeSnapshotService";
import type { GoldenFixture } from "@/models/GoldenTest";

const fresh = (configuration: MassiveTransfusionConfiguration = MTP_REFERENCE_CONFIGURATION) =>
  activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-CALCIUM", { configuration }), "ACTIVATE");

function completeRbc(process: MassiveTransfusionPatientProcessRuntime, number: number): MassiveTransfusionPatientProcessRuntime {
  return tickMassiveTransfusionPatientProcess(startBloodProductAdministration(process, `RBC-${number}`, "RBC", 1), 180);
}

describe("WP-47B MTP calcium replacement", () => {
  test("0, 1 and 2 completed RBC units do not make calcium due", () => {
    let process = fresh();
    expect(process.clinicalState.calciumRecommended).toBe(false);
    process = completeRbc(process, 1); expect(process.clinicalState.calciumRecommended).toBe(false);
    process = completeRbc(process, 2); expect(process.clinicalState.calciumRecommended).toBe(false);
    expect(process.clinicalState.completedRbcUnitsTotal).toBe(2);
  });

  test("the third completed RBC unit creates exactly one due obligation", () => {
    let process = fresh();
    process = completeRbc(process, 1); process = completeRbc(process, 2); process = completeRbc(process, 3);
    expect(process.clinicalState).toMatchObject({ completedRbcUnitsTotal: 3, completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
    expect(drainMassiveTransfusionEvidence(process).evidence.filter(item => item.eventType === "MTP_CALCIUM_DUE")).toHaveLength(1);
  });

  test("started RBC is not counted until canonical completion", () => {
    const started = startBloodProductAdministration(fresh(), "RBC-1", "RBC", 1);
    expect(started.clinicalState.completedRbcUnitsTotal).toBe(0);
    expect(tickMassiveTransfusionPatientProcess(started, 60).clinicalState.completedRbcUnitsTotal).toBe(0);
  });

  test("failed RBC and duplicate RBC command do not increment the completion counter", () => {
    const unavailable = { ...structuredClone(MTP_REFERENCE_CONFIGURATION), initialInventory: { RBC: 0, PLASMA: 6, PLATELETS: 1 } };
    const process = fresh(unavailable);
    expect(() => startBloodProductAdministration(process, "FAILED", "RBC", 1)).toThrow("BLOOD_PRODUCT_UNAVAILABLE");
    const started = startBloodProductAdministration(fresh(), "RBC-1", "RBC", 1);
    const duplicate = startBloodProductAdministration(started, "RBC-1", "RBC", 1);
    const complete = tickMassiveTransfusionPatientProcess(duplicate, 180);
    expect(complete.clinicalState.completedRbcUnitsTotal).toBe(1);
    expect(complete.clinicalState.administrations).toHaveLength(1);
  });

  test("calcium is allowed before RBC and repeated intents remain distinct", () => {
    const process = fresh();
    const early = administerMtpCalcium(process, "CALCIUM-1");
    expect(early.clinicalState).toMatchObject({ completedRbcUnitsSinceLastCalcium: 0, calciumRecommended: false,
      calciumAdministrationCount: 1, calciumLastAdministeredAt: 0 });
    expect(administerMtpCalcium(early, "CALCIUM-1")).toEqual(early);
    const repeated = administerMtpCalcium(early, "CALCIUM-NEW-INTENT");
    expect(repeated.clinicalState.calciumAdministrations).toHaveLength(2);
    expect(repeated.pendingEvidence.filter(item => item.eventType === "MTP_CALCIUM_ADMINISTERED")).toHaveLength(2);
  });

  test("early calcium after RBC one resets the recommendation cycle", () => {
    let process = completeRbc(fresh(), 1);
    expect(process.clinicalState.completedRbcUnitsSinceLastCalcium).toBe(1);
    process = administerMtpCalcium(process, "EARLY-CALCIUM");
    expect(process.clinicalState).toMatchObject({ completedRbcUnitsTotal: 1, completedRbcUnitsSinceLastCalcium: 0,
      calciumRecommended: false, calciumAdministrationCount: 1 });
  });

  test("frequent calcium administrations are valid distinct user intents", () => {
    let process = fresh();
    for (let unit = 1; unit <= 3; unit += 1) {
      process = completeRbc(process, unit);
      process = administerMtpCalcium(process, `CALCIUM-${unit}`);
    }
    expect(process.clinicalState).toMatchObject({ completedRbcUnitsTotal: 3, completedRbcUnitsSinceLastCalcium: 0,
      calciumRecommended: false, calciumAdministrationCount: 3 });
    expect(process.clinicalState.calciumAdministrations.map(item => item.administrationId))
      .toEqual(["CALCIUM-1", "CALCIUM-2", "CALCIUM-3"]);
  });

  test("a second cycle becomes due after RBC six", () => {
    let process = fresh();
    for (let unit = 1; unit <= 3; unit += 1) process = completeRbc(process, unit);
    process = administerMtpCalcium(process, "CALCIUM-1");
    process = completeRbc(process, 4); expect(process.clinicalState.calciumRecommended).toBe(false);
    process = completeRbc(process, 5); expect(process.clinicalState.calciumRecommended).toBe(false);
    process = completeRbc(process, 6); expect(process.clinicalState.calciumRecommended).toBe(true);
    expect(process.clinicalState.completedRbcUnitsTotal).toBe(6);
  });

  test("overdue RBC units keep one obligation and calcium resets from its administration point", () => {
    let process = fresh();
    for (let unit = 1; unit <= 6; unit += 1) process = completeRbc(process, unit);
    expect(process.clinicalState).toMatchObject({ calciumRecommended: true, completedRbcUnitsSinceLastCalcium: 6 });
    expect(drainMassiveTransfusionEvidence(process).evidence.filter(item => item.eventType === "MTP_CALCIUM_DUE")).toHaveLength(1);
    process = administerMtpCalcium(process, "LATE-CALCIUM");
    expect(process.clinicalState.completedRbcUnitsSinceLastCalcium).toBe(0);
  });

  test("restart and takeover copies preserve a single due obligation", () => {
    let process = fresh();
    process = completeRbc(process, 1); process = completeRbc(process, 2); process = completeRbc(process, 3);
    const restarted = structuredClone(process); const takenOver = structuredClone(restarted);
    expect(takenOver.clinicalState).toMatchObject({ completedRbcUnitsTotal: 3, completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
    expect(administerMtpCalcium(takenOver, "CALCIUM-A").clinicalState.calciumAdministrations).toHaveLength(1);
  });

  test("assessment is not applicable below threshold, not met while overdue and met after administration", () => {
    let process = fresh();
    process = completeRbc(process, 1); process = completeRbc(process, 2);
    expect(assessMtpCalcium(process).status).toBe("NOT_APPLICABLE");
    process = completeRbc(process, 3); expect(assessMtpCalcium(process).status).toBe("NOT_MET");
    process = administerMtpCalcium(process, "CALCIUM"); expect(assessMtpCalcium(process).status).toBe("MET");
  });

  test("calcium never changes MTP vital contributions", () => {
    let process = fresh();
    process = completeRbc(process, 1); process = completeRbc(process, 2); process = completeRbc(process, 3);
    const before = structuredClone(process.outputs.vitalContributions);
    expect(administerMtpCalcium(process, "CALCIUM").outputs.vitalContributions).toEqual(before);
  });

  test("feature-disabled configuration preserves blood-product behaviour and rejects calcium", () => {
    const configuration = { ...structuredClone(MTP_REFERENCE_CONFIGURATION), calciumReplacement: { ...MTP_REFERENCE_CONFIGURATION.calciumReplacement!, calciumEnabled: false } };
    let process = fresh(configuration);
    process = completeRbc(process, 1); process = completeRbc(process, 2); process = completeRbc(process, 3);
    expect(process.clinicalState.calciumRecommended).toBe(false);
    expect(process.clinicalState.administeredUnits.RBC).toBe(3);
    expect(() => administerMtpCalcium(process, "CALCIUM")).toThrow("MTP_CALCIUM_DISABLED");
  });

  test("invalid calcium configuration fails closed", () => {
    const configuration = { ...structuredClone(MTP_REFERENCE_CONFIGURATION), calciumReplacement: { ...MTP_REFERENCE_CONFIGURATION.calciumReplacement!, rbcUnitsPerCalcium: 0 } };
    expect(() => bootstrapMassiveTransfusionPatientProcess("PT", { configuration })).toThrow("MTP_CALCIUM_CONFIGURATION_INVALID");
  });

  test("canonical RuntimeSnapshot projects MTP calcium state to CM and Inspector consumers", () => {
    const fixture: GoldenFixture = { fixtureId: "FX-CALCIUM-PROJECTION", fixtureType: "PROCESS", patientId: "PT-CALCIUM", seed: 47,
      clockState: "RUNNING", ownershipVersion: 1, loadedModules: ["MASSIVE_TRANSFUSION_V1"], activeResources: {},
      initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70,
        reserveLossPerMin: 0, co2Burden: 35, co2GainPerMin: 0, massiveTransfusion: { configuration: MTP_REFERENCE_CONFIGURATION } } };
    const engine = new ClinicalScenarioEngine(); engine.reset(fixture);
    expect(getCanonicalPatientRuntimeSnapshot("PT-CALCIUM")?.processes.find(item => item.moduleId === "MASSIVE_TRANSFUSION_V1")?.clinicalState)
      .toMatchObject({ rbcUnitsPerCalcium: 3, completedRbcUnitsTotal: 0, calciumRecommended: false });
  });
});
