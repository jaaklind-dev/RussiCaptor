import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { RuntimeResource } from "@/models/ResourceRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";
import { circulationAssessmentRules } from "@/services/runtime/assessment/CirculationAssessmentRules";
import { CirculationManagementFramework } from "@/services/runtime/clinical/CirculationManagementFramework";

function instance(id: string, definitionId: string, status: InterventionInstance["status"] = "RUNNING", resourceIds: string[] = []): InterventionInstance {
  return { instanceId: id, definitionId, definitionVersion: "1", definitionName: definitionId,
    encounterId: "PT-C", patientId: "PT-C", status, startedAt: 1,
    ...(status === "RUNNING" ? {} : { endedAt: 2 }), parameters: { location: id }, resourceIds,
    sourceInterventionId: id };
}

describe("WP-13 CirculationState", () => {
  test.each(["peripheralIV", "intraosseousAccess"] as const)("%s supports reserve and release", type => {
    const pool = new ResourcePool([{ resourceId: type, type, status: "AVAILABLE", metadata: {} }]);
    expect(pool.reserve(type, "PT-C")).toMatchObject({ status: "RESERVED", assignedPatientId: "PT-C" });
    expect(pool.release(type)).toMatchObject({ status: "AVAILABLE", assignedPatientId: undefined });
  });

  test("supports multiple simultaneous IV access and independent removal", () => {
    const framework = new CirculationManagementFramework();
    expect(framework.apply(instance("IV-1", "PERIPHERAL_IV_ACCESS", "RUNNING", ["IV-R1"]))).toEqual([]);
    framework.apply(instance("IV-1", "PERIPHERAL_IV_ACCESS", "COMPLETED", ["IV-R1"]));
    framework.apply(instance("IV-2", "PERIPHERAL_IV_ACCESS", "COMPLETED", ["IV-R2"]));
    expect(framework.getState("PT-C").vascularAccess).toHaveLength(2);
    expect(framework.apply(instance("IV-1", "PERIPHERAL_IV_ACCESS", "CANCELLED"))[0].eventType).toBe("VascularAccessRemoved");
    expect(framework.getState("PT-C").vascularAccess.map(item => item.interventionInstanceId)).toEqual(["IV-2"]);
  });

  test("tourniquet, pelvic binder and infusions have deterministic apply/remove events", () => {
    const framework = new CirculationManagementFramework();
    expect(framework.apply(instance("TQ", "TOURNIQUET_APPLICATION"))[0].eventType).toBe("TourniquetApplied");
    expect(framework.apply(instance("PB", "PELVIC_BINDER_APPLICATION"))[0].eventType).toBe("PelvicBinderApplied");
    expect(framework.apply(instance("FLUID", "CRYSTALLOID_INFUSION"))[0].eventType).toBe("InfusionStarted");
    expect(framework.apply(instance("TQ", "TOURNIQUET_APPLICATION", "CANCELLED"))[0].eventType).toBe("TourniquetRemoved");
    expect(framework.apply(instance("PB", "PELVIC_BINDER_APPLICATION", "CANCELLED"))[0].eventType).toBe("PelvicBinderRemoved");
    expect(framework.apply(instance("FLUID", "CRYSTALLOID_INFUSION", "COMPLETED"))[0].eventType).toBe("InfusionStopped");
  });
});

test("WP-13 pelvic stabilization conflict uses existing priority planner", () => {
  const resources: RuntimeResource[] = ["PB-1", "PB-2"].map(resourceId => ({ resourceId,
    type: "pelvicBinder", status: "AVAILABLE", exclusiveGroup: "pelvicStabilization", metadata: {} }));
  const pool = new ResourcePool(resources); const engine = new InterventionEngine();
  engine.schedule({ interventionId: "LOW", patientId: "PT-C", resourceId: "PB-1", action: "APPLY", timestamp: 1, priority: 1 });
  engine.schedule({ interventionId: "HIGH", patientId: "PT-C", resourceId: "PB-2", action: "APPLY", timestamp: 1, priority: 100 });
  const events = engine.applyDue(1, pool);
  expect(events).toContainEqual(expect.objectContaining({ interventionId: "LOW", reasonCode: "LOWER_PRIORITY" }));
  expect(pool.getAssignedResources("PT-C").map(item => item.resourceId)).toEqual(["PB-2"]);
});

const fixture: GoldenFixture = { fixtureId: "FX-CIRC", fixtureType: "PROCESS", patientId: "PT-C", seed: 13,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: [], activeResources: { resources: [
    { resourceId: "IV-1", type: "peripheralIV", status: "AVAILABLE", metadata: {} },
    { resourceId: "TQ-1", type: "tourniquet", status: "AVAILABLE", metadata: {} },
  ] }, initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV",
    ventilationReserve: 50, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 } };
const tick = (id: string, time: number): GoldenInputEvent => ({ sequenceId: "C", step: time, offsetSec: time,
  eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-C", eventId: id, result: "SUCCESS", payload: { tickMin: 1 } });

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine(); engine.reset(fixture); engine.setAssessmentRules(circulationAssessmentRules);
  engine.scheduleIntervention({ interventionId: "IV-A", patientId: "PT-C", resourceId: "IV-1", action: "APPLY", timestamp: 1,
    definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "left arm", gauge: 18, attempts: 1 } });
  engine.scheduleIntervention({ interventionId: "TQ-A", patientId: "PT-C", resourceId: "TQ-1", action: "APPLY", timestamp: 1,
    definitionId: "TOURNIQUET_APPLICATION", parameters: { limb: "left leg", applicationTime: 1 } });
  engine.advanceTo(1); engine.dispatch(tick("T1", 1)); engine.advanceTo(181); engine.dispatch(tick("T2", 181)); return engine;
}

test("WP-13 ScenarioEngine circulation, events, assessment and replay are deterministic", () => {
  const first = replay(); const second = replay();
  expect(first.getCirculationState()).toMatchObject({
    vascularAccess: [expect.objectContaining({ type: "PERIPHERAL_IV" })], hemorrhageControl: ["TOURNIQUET"],
  });
  expect(first.getEventLog().map(item => item.eventType)).toEqual(expect.arrayContaining(["VascularAccessEstablished", "TourniquetApplied"]));
  expect(first.getAssessmentSnapshot()).toEqual(second.getAssessmentSnapshot());
  expect(first.getRuntimeState()).toEqual(second.getRuntimeState());
  expect(first.getResourcePoolSnapshot()).toEqual(second.getResourcePoolSnapshot());
  expect(first.getEventLog()).toEqual(second.getEventLog());
  expect(first.getHashes()).toEqual(second.getHashes());
});
