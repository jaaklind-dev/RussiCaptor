import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION, type MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, administerMtpCalcium, bootstrapMassiveTransfusionPatientProcess,
  reconcileMtpVascularAccess, startBloodProductAdministration, terminateBloodProductAdministration,
  tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { assessMtpCalcium } from "@/services/runtime/assessment/MtpCalciumAssessment";

const inactive = () => bootstrapMassiveTransfusionPatientProcess("PT-GLOBAL-CALCIUM", { configuration: MTP_REFERENCE_CONFIGURATION });
const completeRbc = (process: MassiveTransfusionPatientProcessRuntime, id: string) =>
  tickMassiveTransfusionPatientProcess(startBloodProductAdministration(process, id, "RBC", 1), 180);
const state = (process: MassiveTransfusionPatientProcessRuntime) => process.clinicalState.transfusionCalcium;
const timed = (lineCount = 3) => reconcileMtpVascularAccess(bootstrapMassiveTransfusionPatientProcess("PT-TIMED", {
  configuration: { ...structuredClone(MTP_REFERENCE_CONFIGURATION), bloodProductDelivery: WP47C_DEFAULT_DELIVERY_CONFIGURATION },
}), Array.from({ length: lineCount }, (_, index) => ({ interventionInstanceId: `ACCESS-${index + 1}`, type: "PERIPHERAL_IV" as const,
  site: `SITE-${index + 1}`, establishedAt: index, resourceIds: [`RESOURCE-${index + 1}`] })));

describe("WP-47E global RBC to calcium recommendation", () => {
  test("three RBC completions count globally without MTP activation", () => {
    let process = inactive();
    process = completeRbc(process, "RBC-1");
    expect(state(process)).toMatchObject({ completedRbcUnitsSinceLastCalcium: 1, calciumRecommended: false });
    process = completeRbc(process, "RBC-2");
    expect(state(process)).toMatchObject({ completedRbcUnitsSinceLastCalcium: 2, calciumRecommended: false });
    process = completeRbc(process, "RBC-3");
    expect(state(process)).toMatchObject({ completedRbcUnitsSinceLastCalcium: 3, completedRbcUnitsTotal: 3, calciumRecommended: true });
    expect(process.clinicalState.activated).toBe(false);
  });

  test("calcium is available without MTP and resets only the current cycle", () => {
    let process = completeRbc(completeRbc(inactive(), "RBC-1"), "RBC-2");
    process = administerMtpCalcium(process, "CALCIUM-1");
    expect(state(process)).toMatchObject({ completedRbcUnitsTotal: 2, completedRbcUnitsSinceLastCalcium: 0,
      calciumRecommended: false, calciumAdministrationCount: 1 });
    expect(process.clinicalState.activated).toBe(false);
  });

  test("MTP activation preserves prior global RBC exposure", () => {
    let process = completeRbc(completeRbc(inactive(), "RBC-1"), "RBC-2");
    process = activateMassiveTransfusion(process, "ACTIVATE");
    expect(state(process).completedRbcUnitsSinceLastCalcium).toBe(2);
    process = completeRbc(process, "RBC-3");
    expect(state(process)).toMatchObject({ completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
  });

  test("early and repeated calcium remain valid without MTP", () => {
    let process = completeRbc(inactive(), "RBC-1");
    process = administerMtpCalcium(process, "CALCIUM-1");
    process = completeRbc(process, "RBC-2");
    process = administerMtpCalcium(process, "CALCIUM-2");
    expect(state(process)).toMatchObject({ completedRbcUnitsTotal: 2, completedRbcUnitsSinceLastCalcium: 0,
      calciumAdministrationCount: 2, calciumRecommended: false });
  });

  test("same calcium command replay is idempotent while a new intent is distinct", () => {
    const once = administerMtpCalcium(inactive(), "CALCIUM");
    expect(administerMtpCalcium(once, "CALCIUM")).toEqual(once);
    expect(state(administerMtpCalcium(once, "CALCIUM-NEW")).calciumAdministrationCount).toBe(2);
  });

  test("RBC command replay does not create or count a second administration", () => {
    const started = startBloodProductAdministration(inactive(), "RBC", "RBC", 1);
    const replayed = startBloodProductAdministration(started, "RBC", "RBC", 1);
    const completed = tickMassiveTransfusionPatientProcess(replayed, 180);
    expect(completed.clinicalState.administrations).toHaveLength(1);
    expect(state(completed).completedRbcUnitsSinceLastCalcium).toBe(1);
  });

  test.each(["CANCELLED", "FAILED"] as const)("%s RBC is never counted", terminal => {
    const started = startBloodProductAdministration(inactive(), `RBC-${terminal}`, "RBC", 1);
    const stopped = terminateBloodProductAdministration(started, `RBC-${terminal}`, terminal);
    const after = tickMassiveTransfusionPatientProcess(stopped, 180);
    expect(state(after).completedRbcUnitsTotal).toBe(0);
  });

  test("timed RBC counts at completion and never at start or 719 seconds", () => {
    let process = startBloodProductAdministration(timed(1), "RBC", "RBC", 1, "GRAVITY");
    expect(state(process).completedRbcUnitsTotal).toBe(0);
    process = tickMassiveTransfusionPatientProcess(process, 719);
    expect(state(process).completedRbcUnitsTotal).toBe(0);
    process = tickMassiveTransfusionPatientProcess(process, 1);
    expect(state(process).completedRbcUnitsTotal).toBe(1);
  });

  test("three parallel RBC completions deterministically advance zero to three once", () => {
    let process = timed();
    process = startBloodProductAdministration(process, "RBC-1", "RBC", 1, "GRAVITY");
    process = startBloodProductAdministration(process, "RBC-2", "RBC", 1, "GRAVITY");
    process = startBloodProductAdministration(process, "RBC-3", "RBC", 1, "GRAVITY");
    process = tickMassiveTransfusionPatientProcess(process, 720);
    expect(state(process)).toMatchObject({ completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
    expect(state(tickMassiveTransfusionPatientProcess(process, 60)).completedRbcUnitsSinceLastCalcium).toBe(3);
  });

  test("restart and takeover preserve counter two and the next completion reaches recommendation", () => {
    const deviceA = completeRbc(completeRbc(inactive(), "RBC-1"), "RBC-2");
    const restarted = structuredClone(deviceA);
    const deviceB = structuredClone(restarted);
    expect(state(deviceB).completedRbcUnitsSinceLastCalcium).toBe(2);
    expect(state(completeRbc(deviceB, "RBC-3"))).toMatchObject({ completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
  });

  test("restart preserves an already recommended state", () => {
    const process = completeRbc(completeRbc(completeRbc(inactive(), "RBC-1"), "RBC-2"), "RBC-3");
    expect(state(structuredClone(process))).toMatchObject({ completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
  });

  test("legacy WP-47B flat checkpoint migrates to one canonical state", () => {
    const current = inactive();
    const legacy = structuredClone(current) as unknown as MassiveTransfusionPatientProcessRuntime & { clinicalState: Record<string, unknown> };
    // Deliberately constructs the shape emitted by WP-47B checkpoints.
    const legacyState = legacy.clinicalState as Record<string, unknown>;
    delete legacyState.transfusionCalcium;
    Object.assign(legacyState, { completedRbcUnitsTotal: 2, completedRbcUnitsSinceLastCalcium: 2,
      rbcUnitsPerCalcium: 3, calciumRecommended: false, calciumAdministrations: [], calciumLastAdministeredAt: null,
      calciumAdministrationCount: 0 });
    const migrated = activateMassiveTransfusion(legacy, "ACTIVATE");
    expect(state(migrated)).toMatchObject({ completedRbcUnitsTotal: 2, completedRbcUnitsSinceLastCalcium: 2, calciumRecommended: false });
    expect(migrated.clinicalState).not.toHaveProperty("completedRbcUnitsSinceLastCalcium");
  });

  test("assessment is driven by global exposure even when MTP was never activated", () => {
    let process = completeRbc(completeRbc(inactive(), "RBC-1"), "RBC-2");
    expect(assessMtpCalcium(process).status).toBe("NOT_APPLICABLE");
    process = completeRbc(process, "RBC-3");
    expect(process.clinicalState.activated).toBe(false);
    expect(assessMtpCalcium(process).status).toBe("NOT_MET");
    expect(assessMtpCalcium(administerMtpCalcium(process, "CALCIUM")).status).toBe("MET");
  });
});
