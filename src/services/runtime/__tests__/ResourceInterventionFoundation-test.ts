import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { RuntimeResource } from "@/models/ResourceRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";

const resources: RuntimeResource[] = [
  { resourceId: "VENT-1", type: "ventilator", status: "AVAILABLE", metadata: { ward: "ICU" } },
  { resourceId: "O2-1", type: "oxygen", status: "AVAILABLE", metadata: {} },
];

describe("WP-9 ResourcePool", () => {
  test("reserves, reports assignment and releases a resource", () => {
    const pool = new ResourcePool(resources);
    expect(pool.isAvailable("VENT-1")).toBe(true);
    expect(pool.reserve("VENT-1", "PT-1")).toMatchObject({ status: "RESERVED", assignedPatientId: "PT-1" });
    expect(pool.isAvailable("VENT-1")).toBe(false);
    expect(pool.getAssignedResources("PT-1").map(item => item.resourceId)).toEqual(["VENT-1"]);
    expect(pool.release("VENT-1")).toMatchObject({ status: "AVAILABLE", assignedPatientId: undefined });
  });

  test("rejects double reserve, invalid release and missing resources", () => {
    const pool = new ResourcePool(resources);
    pool.reserve("O2-1", "PT-1");
    expect(() => pool.reserve("O2-1", "PT-2")).toThrow("pole saadaval");
    expect(() => pool.release("VENT-1")).toThrow("pole reserveeritud");
    expect(() => pool.reserve("MISSING", "PT-1")).toThrow("puudub");
  });

  test("snapshot and hash are independent of input order", () => {
    const first = new ResourcePool(resources);
    const second = new ResourcePool([...resources].reverse());
    expect(second.snapshot()).toEqual(first.snapshot());
    expect(second.hash()).toBe(first.hash());
  });
});

describe("WP-9 Intervention Engine", () => {
  test("applies deterministic APPLY and REMOVE lifecycle", () => {
    const pool = new ResourcePool(resources);
    const interventions = new InterventionEngine();
    interventions.schedule({ interventionId: "I-REMOVE", patientId: "PT-1", resourceId: "VENT-1", action: "REMOVE", timestamp: 20 });
    interventions.schedule({ interventionId: "I-APPLY", patientId: "PT-1", resourceId: "VENT-1", action: "APPLY", timestamp: 10 });
    expect(interventions.applyDue(10, pool).map(item => item.eventType)).toEqual([
      "ResourceReserved", "InterventionApplied",
    ]);
    expect(interventions.applyDue(20, pool).map(item => item.eventType)).toEqual([
      "ResourceReleased", "InterventionRemoved",
    ]);
    expect(pool.isAvailable("VENT-1")).toBe(true);
    expect(interventions.snapshot()).toEqual({ pending: [], active: [], completed: ["I-APPLY", "I-REMOVE"] });
  });
});

const fixture: GoldenFixture = {
  fixtureId: "FX-RESOURCE", fixtureType: "PROCESS", patientId: "PT-RESOURCE", seed: 901,
  clockState: "RUNNING", ownershipVersion: 1,
  activeResources: { resources }, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1"],
  initialState: {
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV_NM_SEV",
    ventilationReserve: 52, reserveLossPerMin: 3.8, co2Burden: 38, co2GainPerMin: 4,
  },
};

function tick(id: string, time: number): GoldenInputEvent {
  return { sequenceId: "SEQ-RESOURCE", step: time, offsetSec: time, eventType: "ENGINE_TICK",
    actor: "ENGINE", target: "PT-RESOURCE", eventId: id, result: "SUCCESS", payload: { tickMin: 1 } };
}

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(fixture);
  engine.scheduleIntervention({ interventionId: "I-APPLY", patientId: "PT-RESOURCE", resourceId: "VENT-1", action: "APPLY", timestamp: 1, sourceProcessId: "HV_NM_SEV" });
  engine.scheduleIntervention({ interventionId: "I-REMOVE", patientId: "PT-RESOURCE", resourceId: "VENT-1", action: "REMOVE", timestamp: 2, sourceProcessId: "HV_NM_SEV" });
  engine.advanceTo(1);
  engine.dispatch(tick("TICK-1", 1));
  engine.advanceTo(2);
  engine.dispatch(tick("TICK-2", 2));
  return engine;
}

describe("WP-9 ScenarioEngine resource integration", () => {
  test("replay includes deterministic pool, event log and hashes", () => {
    const first = replay();
    const second = replay();
    expect(second.getRuntimeState()).toEqual(first.getRuntimeState());
    expect(second.getResourcePoolSnapshot()).toEqual(first.getResourcePoolSnapshot());
    expect(second.getResourcePoolHash()).toBe(first.getResourcePoolHash());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getPatientProcesses()).toEqual(first.getPatientProcesses());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(first.getEventLog().map(item => item.eventType)).toEqual([
      "ResourceReserved", "InterventionApplied", "ENGINE_TICK_APPLIED",
      "ResourceReleased", "InterventionRemoved", "ENGINE_TICK_APPLIED",
    ]);
  });
});
