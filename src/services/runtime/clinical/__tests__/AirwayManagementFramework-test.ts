import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { RuntimeResource, SchedulableIntervention } from "@/models/ResourceRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { InterventionEngine } from "@/services/runtime/InterventionEngine";
import { ResourcePool } from "@/services/runtime/ResourcePool";
import { AirwayManagementFramework } from "@/services/runtime/clinical/AirwayManagementFramework";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { InterventionRuntime } from "@/services/runtime/clinical/InterventionRuntime";

const definitions = new InterventionDefinitionRegistry(airwayInterventionDefinitions);

function instance(definitionId: string, status: InterventionInstance["status"] = "RUNNING", overrides: Partial<InterventionInstance> = {}): InterventionInstance {
  return {
    instanceId: `${definitionId}:1`, definitionId, definitionVersion: "1.0.0", definitionName: definitionId,
    encounterId: "PT-AIR", patientId: "PT-AIR", status, startedAt: 1,
    ...(status === "RUNNING" ? {} : { endedAt: 2 }), parameters: {}, resourceIds: [],
    sourceInterventionId: `${definitionId}:SOURCE`, ...overrides,
  };
}

describe("WP-11 AirwayState and events", () => {
  test.each([
    ["OROPHARYNGEAL_AIRWAY", "OPA"], ["NASOPHARYNGEAL_AIRWAY", "NPA"],
    ["SUPRAGLOTTIC_IGEL", "SUPRAGLOTTIC"], ["SUPRAGLOTTIC_LMA", "SUPRAGLOTTIC"],
  ])("%s insert/remove lifecycle", (definitionId, expected) => {
    const framework = new AirwayManagementFramework();
    expect(framework.apply(instance(definitionId))[0].eventType).toBe("AirwayInserted");
    expect(framework.getState("PT-AIR").activeAirway).toBe(expected);
    expect(framework.apply(instance(definitionId, "CANCELLED"))[0].eventType).toBe("AirwayRemoved");
    expect(framework.getState("PT-AIR").activeAirway).toBe("NONE");
  });

  test("ET insertion records confirmation and BVM/ventilator record ventilation lifecycle", () => {
    const framework = new AirwayManagementFramework();
    expect(framework.apply(instance("ENDOTRACHEAL_INTUBATION", "RUNNING", { parameters: { confirmation: true } }))
      .map(event => event.eventType)).toEqual(["AirwayInserted", "AirwayConfirmed"]);
    expect(framework.getState("PT-AIR")).toMatchObject({ activeAirway: "ENDOTRACHEAL", confirmed: true });
    expect(framework.apply(instance("BAG_VALVE_MASK_VENTILATION"))[0].eventType).toBe("VentilationStarted");
    expect(framework.getState("PT-AIR").currentVentilation).toBe("BVM");
    expect(framework.apply(instance("BAG_VALVE_MASK_VENTILATION", "CANCELLED"))[0].eventType).toBe("VentilationStopped");
    expect(framework.apply(instance("MECHANICAL_VENTILATION"))[0].eventType).toBe("VentilationStarted");
    expect(framework.getState("PT-AIR").currentVentilation).toBe("MECHANICAL");
  });
});

describe("WP-11 airway resource conflicts", () => {
  const resources: RuntimeResource[] = [
    { resourceId: "OPA", type: "oropharyngealAirway", status: "AVAILABLE", exclusiveGroup: "airwayAdjunct", metadata: {} },
    { resourceId: "NPA", type: "nasopharyngealAirway", status: "AVAILABLE", exclusiveGroup: "airwayAdjunct", metadata: {} },
    { resourceId: "BVM", type: "bagValveMask", status: "AVAILABLE", exclusiveGroup: "activeVentilation", metadata: {} },
    { resourceId: "VENT", type: "ventilator", status: "AVAILABLE", exclusiveGroup: "activeVentilation", metadata: {} },
  ];
  const action = (overrides: Partial<SchedulableIntervention>): SchedulableIntervention => ({
    interventionId: "OPA-I", patientId: "PT-AIR", resourceId: "OPA", action: "APPLY", timestamp: 1,
    definitionId: "OROPHARYNGEAL_AIRWAY", priority: 0, ...overrides,
  });

  test("OPA vs NPA and BVM vs ventilator use priority and exclusive groups", () => {
    const pool = new ResourcePool(resources);
    const interventions = new InterventionEngine();
    [action({ interventionId: "OPA-I", priority: 1 }),
      action({ interventionId: "NPA-I", resourceId: "NPA", definitionId: "NASOPHARYNGEAL_AIRWAY", priority: 10 }),
      action({ interventionId: "BVM-I", resourceId: "BVM", definitionId: "BAG_VALVE_MASK_VENTILATION", priority: 1 }),
      action({ interventionId: "VENT-I", resourceId: "VENT", definitionId: "MECHANICAL_VENTILATION", priority: 10 })]
      .forEach(item => interventions.schedule(item));
    const events = interventions.applyDue(1, pool);
    expect(events).toContainEqual(expect.objectContaining({ interventionId: "OPA-I", reasonCode: "LOWER_PRIORITY" }));
    expect(events).toContainEqual(expect.objectContaining({ interventionId: "BVM-I", reasonCode: "LOWER_PRIORITY" }));
    expect(pool.getAssignedResources("PT-AIR").map(item => item.resourceId)).toEqual(["NPA", "VENT"]);
  });

  test("OPA preconditions and resource release are enforced", () => {
    const runtime = new InterventionRuntime(definitions);
    const reserved = [{ ...resources[0], status: "RESERVED" as const, assignedPatientId: "PT-AIR" }];
    expect(runtime.consumeResourceEvent({ eventType: "InterventionApplied", timestamp: 1, resourceId: "OPA",
      patientId: "PT-AIR", interventionId: "OPA-I", definitionId: "OROPHARYNGEAL_AIRWAY" }, "PT-AIR", reserved,
    { unconscious: false, gagReflexAbsent: false })?.status).toBe("FAILED");
    const valid = new InterventionRuntime(definitions);
    expect(valid.consumeResourceEvent({ eventType: "InterventionApplied", timestamp: 1, resourceId: "OPA",
      patientId: "PT-AIR", interventionId: "OPA-I", definitionId: "OROPHARYNGEAL_AIRWAY" }, "PT-AIR", reserved,
    { unconscious: true, gagReflexAbsent: true })?.status).toBe("RUNNING");
    expect(valid.consumeResourceEvent({ eventType: "InterventionRemoved", timestamp: 2, resourceId: "OPA",
      patientId: "PT-AIR", interventionId: "OPA-R" }, "PT-AIR", resources)?.status).toBe("CANCELLED");
  });

  test.each(["BVM", "VENT"])("%s resource supports reserve and release", resourceId => {
    const pool = new ResourcePool(resources);
    expect(pool.reserve(resourceId, "PT-AIR")).toMatchObject({ status: "RESERVED", assignedPatientId: "PT-AIR" });
    expect(pool.release(resourceId)).toMatchObject({ status: "AVAILABLE", assignedPatientId: undefined });
  });
});

const fixture: GoldenFixture = {
  fixtureId: "FX-AIRWAY", fixtureType: "PROCESS", patientId: "PT-AIR", seed: 11,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1"],
  activeResources: { resources: [{ resourceId: "NPA", type: "nasopharyngealAirway", status: "AVAILABLE",
    exclusiveGroup: "airwayAdjunct", metadata: {} }] },
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV", ventilationReserve: 60,
    reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 },
};
const tick = (id: string, time: number): GoldenInputEvent => ({ sequenceId: "AIR", step: time, offsetSec: time,
  eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-AIR", eventId: id, result: "SUCCESS", payload: { tickMin: 1 } });

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine(); engine.reset(fixture);
  engine.scheduleIntervention({ interventionId: "NPA-I", patientId: "PT-AIR", resourceId: "NPA", action: "APPLY",
    timestamp: 1, definitionId: "NASOPHARYNGEAL_AIRWAY", priority: 10 });
  engine.scheduleIntervention({ interventionId: "NPA-R", patientId: "PT-AIR", resourceId: "NPA", action: "REMOVE", timestamp: 2 });
  engine.advanceTo(1); engine.dispatch(tick("T1", 1)); engine.advanceTo(2); engine.dispatch(tick("T2", 2));
  return engine;
}

test("WP-11 ScenarioEngine replay keeps AirwayState, events, resources and hash identical", () => {
  const first = replay(); const second = replay();
  expect(first.getAirwayState()).toMatchObject({ activeAirway: "NONE", currentVentilation: "NONE" });
  expect(first.getEventLog().map(event => event.eventType)).toEqual(expect.arrayContaining(["AirwayInserted", "AirwayRemoved"]));
  expect(second.getAirwayState()).toEqual(first.getAirwayState());
  expect(second.getResourcePoolSnapshot()).toEqual(first.getResourcePoolSnapshot());
  expect(second.getEventLog()).toEqual(first.getEventLog());
  expect(second.getHashes()).toEqual(first.getHashes());
});
