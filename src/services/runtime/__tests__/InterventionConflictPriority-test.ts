import type { RuntimeResource, SchedulableIntervention } from "@/models/ResourceRuntime";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const resources: RuntimeResource[] = [
  { resourceId: "BVM-1", type: "BVM", status: "AVAILABLE", exclusiveGroup: "activeVentilationDevice", metadata: {} },
  { resourceId: "VENT-1", type: "ventilator", status: "AVAILABLE", exclusiveGroup: "activeVentilationDevice", metadata: {} },
  { resourceId: "MASK-1", type: "oxygenMask", status: "AVAILABLE", metadata: {} },
];

function intervention(overrides: Partial<SchedulableIntervention>): SchedulableIntervention {
  return {
    interventionId: "I-1", patientId: "PT-1", resourceId: "MASK-1",
    action: "APPLY", timestamp: 10, ...overrides,
  };
}

function run(items: SchedulableIntervention[]) {
  const pool = new ResourcePool(resources);
  const engine = new InterventionEngine();
  items.forEach(item => engine.schedule(item));
  const events = engine.applyDue(10, pool);
  return { pool: pool.snapshot(), events, state: engine.snapshot() };
}

describe("WP-9B intervention conflict and priority foundation", () => {
  test("higher numeric priority wins before interventionId", () => {
    const result = run([
      intervention({ interventionId: "A-LOW", priority: 0 }),
      intervention({ interventionId: "Z-HIGH", priority: 100 }),
    ]);
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "InterventionApplied", interventionId: "Z-HIGH" }),
      expect.objectContaining({ eventType: "InterventionRejected", interventionId: "A-LOW", reasonCode: "LOWER_PRIORITY", conflictingInterventionId: "Z-HIGH" }),
    ]));
  });

  test("equal priority uses interventionId only as deterministic tie-breaker", () => {
    const result = run([
      intervention({ interventionId: "B", priority: 10 }),
      intervention({ interventionId: "A", priority: 10 }),
    ]);
    expect(result.events.find(item => item.eventType === "InterventionApplied")?.interventionId).toBe("A");
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: "InterventionRejected", interventionId: "B", reasonCode: "DUPLICATE_ACTION",
      conflictingInterventionId: "A",
    }));
  });

  test("same-resource REMOVE phase runs before APPLY", () => {
    const pool = new ResourcePool(resources);
    pool.reserve("MASK-1", "PT-1");
    const engine = new InterventionEngine();
    engine.schedule(intervention({ interventionId: "Z-APPLY", action: "APPLY", priority: 5 }));
    engine.schedule(intervention({ interventionId: "A-REMOVE", action: "REMOVE", priority: 5 }));
    expect(engine.applyDue(10, pool).map(item => item.eventType)).toEqual([
      "ResourceReleased", "InterventionRemoved", "ResourceReserved", "InterventionApplied",
    ]);
    expect(pool.getAssignedResources("PT-1")).toHaveLength(1);
  });

  test("invalid REMOVE is rejected without preventing a valid APPLY", () => {
    const result = run([
      intervention({ interventionId: "REMOVE", action: "REMOVE" }),
      intervention({ interventionId: "APPLY", action: "APPLY" }),
    ]);
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "InterventionRejected", interventionId: "REMOVE", reasonCode: "INVALID_REMOVE" }),
      expect.objectContaining({ eventType: "InterventionApplied", interventionId: "APPLY" }),
    ]));
  });

  test("exclusive-group preflight selects one winner before mutating the pool", () => {
    const result = run([
      intervention({ interventionId: "BVM", resourceId: "BVM-1", priority: 10 }),
      intervention({ interventionId: "VENT", resourceId: "VENT-1", priority: 100 }),
    ]);
    expect(result.pool.find(item => item.resourceId === "VENT-1")).toMatchObject({ assignedPatientId: "PT-1" });
    expect(result.pool.find(item => item.resourceId === "BVM-1")).toMatchObject({ status: "AVAILABLE" });
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: "InterventionRejected", interventionId: "BVM", reasonCode: "LOWER_PRIORITY",
      conflictingInterventionId: "VENT", exclusiveGroup: "activeVentilationDevice",
    }));
  });

  test("already reserved resource is rejected with stable reason code", () => {
    const pool = new ResourcePool(resources);
    pool.reserve("MASK-1", "PT-2");
    const engine = new InterventionEngine();
    engine.schedule(intervention({ interventionId: "TAKE-MASK" }));
    expect(engine.applyDue(10, pool)).toContainEqual(expect.objectContaining({
      eventType: "InterventionRejected", reasonCode: "RESOURCE_ALREADY_RESERVED",
    }));
    expect(pool.getAssignedResources("PT-2")).toHaveLength(1);
  });

  test("two patients competing for one resource cannot cause an execution-time conflict", () => {
    const result = run([
      intervention({ interventionId: "PT1", patientId: "PT-1", priority: 20 }),
      intervention({ interventionId: "PT2", patientId: "PT-2", priority: 10 }),
    ]);
    expect(result.pool.find(item => item.resourceId === "MASK-1")?.assignedPatientId).toBe("PT-1");
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: "InterventionRejected", interventionId: "PT2", reasonCode: "LOWER_PRIORITY",
      conflictingInterventionId: "PT1",
    }));
  });

  test("schedule order produces identical plan, events and hash", () => {
    const items = [
      intervention({ interventionId: "BVM", resourceId: "BVM-1", priority: 10 }),
      intervention({ interventionId: "VENT", resourceId: "VENT-1", priority: 100 }),
    ];
    const first = run(items);
    const second = run([...items].reverse());
    expect(second).toEqual(first);
    expect(sha256Text(stableJson(second))).toBe(sha256Text(stableJson(first)));
  });

  test("ScenarioEngine logs rejection details and replays them identically", () => {
    const fixture: GoldenFixture = {
      fixtureId: "FX-9B", fixtureType: "PROCESS", patientId: "PT-1", seed: 9,
      clockState: "RUNNING", ownershipVersion: 1, activeResources: { resources }, loadedModules: [],
      initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV",
        ventilationReserve: 50, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 },
    };
    const execute = () => {
      const scenario = new ClinicalScenarioEngine();
      scenario.reset(fixture);
      scenario.scheduleIntervention(intervention({ interventionId: "BVM", resourceId: "BVM-1", priority: 10 }));
      scenario.scheduleIntervention(intervention({ interventionId: "VENT", resourceId: "VENT-1", priority: 100 }));
      scenario.advanceTo(10);
      const tick: GoldenInputEvent = { sequenceId: "SEQ-9B", step: 1, offsetSec: 10,
        eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-1", eventId: "TICK",
        result: "SUCCESS", payload: { tickMin: 1 } };
      scenario.dispatch(tick);
      return scenario;
    };
    const first = execute();
    const second = execute();
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(first.getEventLog()).toContainEqual(expect.objectContaining({
      eventType: "InterventionRejected",
      payload: expect.objectContaining({ reasonCode: "LOWER_PRIORITY", conflictingInterventionId: "VENT",
        exclusiveGroup: "activeVentilationDevice" }),
    }));
  });
});
