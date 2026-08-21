import type { MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture } from "@/services/exercise/CanonicalPatientDatasets";
import { activateMassiveTransfusion, startBloodProductAdministration } from "@/services/runtime/MassiveTransfusionPatientProcess";

const patientId = "PT-PELVIC-001";
const fresh = () => { const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(mtpReferenceFixture)); return engine; };
const start = (engine: ClinicalScenarioEngine, id: string, resourceId: string, definitionId: "PERIPHERAL_IV_ACCESS" | "CENTRAL_VENOUS_ACCESS") => {
  engine.scheduleIntervention({ interventionId: id, patientId, resourceId, action: "APPLY", timestamp: engine.getRuntimeState().exerciseTimeSec,
    definitionId, parameters: definitionId === "PERIPHERAL_IV_ACCESS" ? { location: "arm", gauge: 18, attempts: 1 } : { location: "neck" } });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
};
const advance = (engine: ClinicalScenarioEngine, to: number, id = `TICK-${to}`) => { const from = engine.getRuntimeState().exerciseTimeSec;
  engine.advanceTo(to); engine.dispatch({ sequenceId: "TIMED-ACCESS", step: to, offsetSec: to, eventType: "ENGINE_TICK", actor: "ENGINE",
    target: patientId, eventId: id, result: "SUCCESS", payload: { tickMin: (to - from) / 60 } }); };
const mtp = (engine: ClinicalScenarioEngine) => engine.getPatientProcesses()
  .find(item => item.processType === "MASSIVE_TRANSFUSION") as unknown as MassiveTransfusionPatientProcessRuntime;
const accessInstances = (engine: ClinicalScenarioEngine) => engine.getInterventionInstances(patientId)
  .filter(item => item.definitionId === "PERIPHERAL_IV_ACCESS" || item.definitionId === "CENTRAL_VENOUS_ACCESS");

describe("WP-47D timed vascular-access establishment", () => {
  test("peripheral access is RUNNING and unavailable at start and 179 seconds", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS");
    expect(accessInstances(engine)[0]).toMatchObject({ status: "RUNNING", startedAt: 0 });
    expect(engine.getCirculationState().vascularAccess).toHaveLength(0); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
    advance(engine, 179); expect(accessInstances(engine)[0].status).toBe("RUNNING"); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
  });

  test("peripheral access completes and becomes one usable line exactly at 180 seconds", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS"); advance(engine, 180);
    expect(accessInstances(engine)[0]).toMatchObject({ status: "COMPLETED", endedAt: 180 });
    expect(engine.getCirculationState().vascularAccess).toHaveLength(1); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(1);
  });

  test("central access is unavailable at 599 and available at 600 seconds", () => {
    const engine = fresh(); start(engine, "CVC-A", "CVC-1", "CENTRAL_VENOUS_ACCESS"); advance(engine, 599);
    expect(accessInstances(engine)[0].status).toBe("RUNNING"); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
    advance(engine, 600); expect(accessInstances(engine)[0]).toMatchObject({ status: "COMPLETED", endedAt: 600 });
    expect(mtp(engine).clinicalState.vascularAccessCount).toBe(1);
  });

  test("two peripheral procedures establish concurrently", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS"); start(engine, "PIV-B", "PIV-2", "PERIPHERAL_IV_ACCESS");
    advance(engine, 179); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
    advance(engine, 180); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(2);
  });

  test("peripheral and central procedures retain independent canonical deadlines", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS"); start(engine, "CVC-A", "CVC-1", "CENTRAL_VENOUS_ACCESS");
    advance(engine, 180); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(1);
    advance(engine, 599); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(1);
    advance(engine, 600); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(2);
  });

  test("RUNNING access cannot carry a blood product", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS");
    expect(() => startBloodProductAdministration(activateMassiveTransfusion(mtp(engine), "ACTIVATE"), "RBC-A", "RBC", 1))
      .toThrow("NO_FREE_VASCULAR_ACCESS");
  });

  test("cancelled access creates no line", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS");
    expect(engine.stopClinicalIntervention("PIV-A")?.status).toBe("CANCELLED"); advance(engine, 180);
    expect(engine.getCirculationState().vascularAccess).toHaveLength(0); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
  });

  test("failed access request creates no line", () => {
    const engine = fresh(); engine.scheduleIntervention({ interventionId: "PIV-FAIL", patientId, resourceId: "MISSING", action: "APPLY", timestamp: 0,
      definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "arm", gauge: 18, attempts: 1 } });
    engine.applyScheduledResourceInterventionsAtCurrentTime(); advance(engine, 180);
    expect(engine.getCirculationState().vascularAccess).toHaveLength(0); expect(mtp(engine).clinicalState.vascularAccessCount).toBe(0);
  });

  test("restart at 120 seconds preserves RUNNING state and the remaining 60 seconds", () => {
    const source = fresh(); start(source, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS"); advance(source, 120);
    const resumed = fresh(); resumed.rehydrateRuntimePayload(source.captureRuntimePayload());
    expect(accessInstances(resumed)[0]).toMatchObject({ status: "RUNNING", startedAt: 0 }); expect(mtp(resumed).clinicalState.vascularAccessCount).toBe(0);
    advance(resumed, 180, "RESTART-COMPLETE"); expect(accessInstances(resumed)[0]).toMatchObject({ status: "COMPLETED", endedAt: 180 });
    expect(mtp(resumed).clinicalState.vascularAccessCount).toBe(1);
  });

  test("takeover at 300 seconds preserves central access deadline and creates one line at 600", () => {
    const deviceA = fresh(); start(deviceA, "CVC-A", "CVC-1", "CENTRAL_VENOUS_ACCESS"); advance(deviceA, 300);
    const deviceB = fresh(); deviceB.rehydrateRuntimePayload(deviceA.captureRuntimePayload());
    expect(accessInstances(deviceB)[0]).toMatchObject({ status: "RUNNING", startedAt: 0 }); expect(mtp(deviceB).clinicalState.vascularAccessCount).toBe(0);
    advance(deviceB, 599, "TAKEOVER-599"); expect(mtp(deviceB).clinicalState.vascularAccessCount).toBe(0);
    advance(deviceB, 600, "TAKEOVER-600"); expect(mtp(deviceB).clinicalState.vascularAccessCount).toBe(1);
  });

  test("canonical log records start and completion once without per-second events", () => {
    const engine = fresh(); start(engine, "PIV-A", "PIV-1", "PERIPHERAL_IV_ACCESS"); advance(engine, 60); advance(engine, 120); advance(engine, 180);
    const types = engine.getEventLog().map(item => item.eventType);
    expect(types.filter(type => type === "VascularAccessEstablishmentStarted")).toHaveLength(1);
    expect(types.filter(type => type === "VascularAccessEstablished")).toHaveLength(1);
  });
});
