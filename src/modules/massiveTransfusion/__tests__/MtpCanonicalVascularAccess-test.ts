import fs from "node:fs";
import path from "node:path";

import type { ActiveVascularAccess } from "@/models/CirculationState";
import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess, reconcileMtpVascularAccess,
  startBloodProductAdministration } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture } from "@/services/exercise/CanonicalPatientDatasets";

const access = (id: string, type: ActiveVascularAccess["type"], establishedAt: number): ActiveVascularAccess => ({
  interventionInstanceId: id, type, resourceIds: [`RESOURCE-${id}`], establishedAt,
});
const peripheral = (id: string, establishedAt: number) => access(id, "PERIPHERAL_IV", establishedAt);
const central = (id: string, establishedAt: number) => access(id, "CENTRAL_ACCESS", establishedAt);
const fresh = () => activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-WP47D", { configuration: {
  ...structuredClone(MTP_REFERENCE_CONFIGURATION), bloodProductDelivery: { ...WP47C_DEFAULT_DELIVERY_CONFIGURATION },
} }), "ACTIVATE");

describe("WP-47D canonical vascular access integration", () => {
  test("zero established access exposes zero lines and blocks transfusion", () => {
    const process = reconcileMtpVascularAccess(fresh(), []);
    expect(process.clinicalState.vascularAccessCount).toBe(0);
    expect(process.clinicalState.vascularAccessLines.every(line => line.status === "MISSING")).toBe(true);
    expect(() => startBloodProductAdministration(process, "RBC-1", "RBC", 1)).toThrow("NO_FREE_VASCULAR_ACCESS");
  });

  test("one peripheral access adds one identity-preserving line", () => {
    const process = reconcileMtpVascularAccess(fresh(), [peripheral("P-IV-A", 10)]);
    expect(process.clinicalState.vascularAccessLines[0]).toMatchObject({ lineId: "IV-1", status: "FREE",
      accessInterventionInstanceId: "P-IV-A", accessType: "PERIPHERAL_IV" });
  });

  test("two peripheral accesses produce two deterministic lines", () => {
    const process = reconcileMtpVascularAccess(fresh(), [peripheral("P-IV-B", 20), peripheral("P-IV-A", 10)]);
    expect(process.clinicalState.vascularAccessLines.map(line => line.accessInterventionInstanceId)).toEqual(["P-IV-A", "P-IV-B", undefined]);
  });

  test("peripheral and central access each contribute one line", () => {
    const process = reconcileMtpVascularAccess(fresh(), [peripheral("P-IV", 10), central("CVC", 20)]);
    expect(process.clinicalState.vascularAccessCount).toBe(2);
    expect(process.clinicalState.vascularAccessLines.slice(0, 2).map(line => line.accessType)).toEqual(["PERIPHERAL_IV", "CENTRAL_ACCESS"]);
  });

  test("fourth canonical access remains outside the MTP cap of three", () => {
    const accesses = [peripheral("A", 1), peripheral("B", 2), central("C", 3), central("D", 4)];
    const process = reconcileMtpVascularAccess(fresh(), accesses);
    expect(process.clinicalState.vascularAccessCount).toBe(3);
    expect(process.clinicalState.vascularAccessLines.map(line => line.accessInterventionInstanceId)).toEqual(["A", "B", "C"]);
  });

  test("restart and takeover preserve access-to-line identity", () => {
    const running = startBloodProductAdministration(reconcileMtpVascularAccess(fresh(), [peripheral("A", 1), central("B", 2)]),
      "RBC-1", "RBC", 1, "GRAVITY");
    const restarted = reconcileMtpVascularAccess(structuredClone(running), [central("B", 2), peripheral("A", 1)]);
    expect(restarted.clinicalState.vascularAccessLines).toEqual(running.clinicalState.vascularAccessLines);
    expect(structuredClone(restarted).clinicalState.vascularAccessLines).toEqual(running.clinicalState.vascularAccessLines);
  });

  test("losing a free line decreases capacity without renumbering retained access", () => {
    const before = reconcileMtpVascularAccess(fresh(), [peripheral("A", 1), central("B", 2)]);
    const after = reconcileMtpVascularAccess(before, [central("B", 2)]);
    expect(after.clinicalState.vascularAccessCount).toBe(1);
    expect(after.clinicalState.vascularAccessLines[1]).toMatchObject({ lineId: "IV-2", accessInterventionInstanceId: "B", status: "FREE" });
    expect(after.clinicalState.vascularAccessLines[0].status).toBe("MISSING");
  });

  test("losing an occupied line fails its administration and removes capacity", () => {
    let process = reconcileMtpVascularAccess(fresh(), [peripheral("A", 1)]);
    process = startBloodProductAdministration(process, "RBC-1", "RBC", 1, "GRAVITY");
    process = reconcileMtpVascularAccess(process, []);
    expect(process.clinicalState.administrations[0].state).toBe("FAILED");
    expect(process.clinicalState.vascularAccessLines[0].status).toBe("MISSING");
  });

  test("MTP UI has no manual line-count command or selector", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/patient/MassiveTransfusionControls.tsx"), "utf8");
    expect(source).not.toContain("MTP_SET_VASCULAR_ACCESS_COUNT");
    expect(source).not.toMatch(/\[0,\s*1,\s*2,\s*3\]/);
    expect(source).toContain('line.status === "MISSING" ? "PUUDUB"');
  });

  test("ScenarioEngine projects an established canonical access into MTP before product commands", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(mtpReferenceFixture);
    engine.scheduleIntervention({ interventionId: "PIV-CANONICAL", patientId: "PT-PELVIC-001", resourceId: "PIV-1", action: "APPLY",
      timestamp: 1, definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "left arm", gauge: 18, attempts: 1 } });
    engine.advanceTo(1); engine.dispatch({ sequenceId: "ACCESS", step: 1, offsetSec: 1, eventType: "ENGINE_TICK", actor: "ENGINE",
      target: "PT-PELVIC-001", eventId: "ACCESS-TICK", result: "SUCCESS", payload: { tickMin: 1 / 60 } });
    const mtp = engine.getPatientProcesses().find(process => process.processType === "MASSIVE_TRANSFUSION") as unknown as ReturnType<typeof fresh>;
    expect(engine.getCirculationState().vascularAccess).toHaveLength(1);
    expect(mtp.clinicalState.vascularAccessLines[0]).toMatchObject({ status: "FREE", accessInterventionInstanceId: "PIV-CANONICAL:INSTANCE" });
  });
});
