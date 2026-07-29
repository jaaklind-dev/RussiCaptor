import type { AirwayState } from "@/models/AirwayState";
import type { AssessmentRule, AssessmentSourceSnapshot } from "@/models/ClinicalAssessment";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ClinicalAssessmentEngine } from "@/services/runtime/assessment/ClinicalAssessmentEngine";

const runtimeState: RuntimeState = {
  encounterId: "PT-12", stateVersion: 1, exerciseTimeSec: 90, globalStatus: "Stable",
  targetVitals: {}, displayedVitals: {}, mentalStatusCode: "Alert", symptomTags: [], visibleFindings: [],
  activeAlerts: [], runtimeFields: {}, vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] },
  manualOverrideActive: false, overrideMap: {}, aggregationConfigVersion: "WP-12", randomSeed: 12,
};
const airwayState: AirwayState = {
  patientId: "PT-12", activeAirway: "ENDOTRACHEAL", currentVentilation: "MECHANICAL",
  confirmed: true, updatedAt: 30,
};

function source(overrides: Partial<AssessmentSourceSnapshot> = {}): AssessmentSourceSnapshot {
  const eventLog = [
    { eventType: "AirwayInserted", simulationTime: 10, sequence: 1 },
    { eventType: "AirwayConfirmed", simulationTime: 20, sequence: 2 },
    { eventType: "VentilationStarted", simulationTime: 30, sequence: 3 },
  ];
  return {
    timestamp: 90, runtimeState, eventLog, timeline: eventLog, interventionLog: [],
    interventionInstances: [], resourcePool: [], airwayState, clinicalEffects: [], ...overrides,
  };
}

const rules: AssessmentRule[] = [{
  ruleId: "AIRWAY-001", name: "Airway secured", category: "AIRWAY", severity: "FAIL",
  condition: { type: "EVENT_PRESENT", eventType: "AirwayInserted", deadlineSec: 30 },
  expectedBehaviour: "Secure the airway within 30 seconds.",
}, {
  ruleId: "AIRWAY-002", name: "Airway confirmed after insertion", category: "AIRWAY", severity: "FAIL",
  condition: { type: "EVENT_ORDER", beforeEventType: "AirwayInserted", afterEventType: "AirwayConfirmed" },
  expectedBehaviour: "Confirm the airway after insertion.",
}, {
  ruleId: "VENT-001", name: "No duplicate ventilation start", category: "VENTILATION", severity: "WARNING",
  condition: { type: "EVENT_COUNT_MAX", eventType: "VentilationStarted", maxCount: 1 },
  expectedBehaviour: "Avoid duplicate ventilation starts.",
}, {
  ruleId: "RES-001", name: "No rejected intervention", category: "RESOURCES", severity: "WARNING",
  condition: { type: "INTERVENTION_REJECTED", expected: false },
  expectedBehaviour: "Use an available, compatible resource.",
}, {
  ruleId: "RES-002", name: "No resource conflict", category: "RESOURCES", severity: "FAIL",
  condition: { type: "RESOURCE_CONFLICT", expected: false },
  expectedBehaviour: "Resolve exclusive resource conflicts before intervention.",
}];

describe("WP-12 data-driven rule evaluation", () => {
  test("evaluates present, missing, order and duplicate timeline actions", () => {
    const engine = new ClinicalAssessmentEngine();
    expect(engine.evaluate(rules, source()).results.map(item => item.status)).toEqual([
      "PASS", "PASS", "PASS", "PASS", "PASS",
    ]);
    const wrong = source({ eventLog: [
      { eventType: "AirwayConfirmed", simulationTime: 5, sequence: 1 },
      { eventType: "VentilationStarted", simulationTime: 30, sequence: 2 },
      { eventType: "VentilationStarted", simulationTime: 40, sequence: 3 },
    ], timeline: [] });
    expect(engine.evaluate(rules, wrong).results.map(item => item.status)).toEqual([
      "FAIL", "FAIL", "PASS", "PASS", "WARNING",
    ]);
  });

  test("detects rejected interventions and resource conflicts", () => {
    const snapshot = new ClinicalAssessmentEngine().evaluate(rules, source({ interventionLog: [{
      eventType: "InterventionRejected", timestamp: 15, resourceId: "OPA", patientId: "PT-12",
      interventionId: "I-1", reasonCode: "EXCLUSIVE_GROUP_CONFLICT",
    }] }));
    expect(snapshot.results.find(item => item.ruleId === "RES-001")?.status).toBe("WARNING");
    expect(snapshot.results.find(item => item.ruleId === "RES-002")?.status).toBe("FAIL");
    expect(snapshot.events.map(item => item.eventType)).toContain("AssessmentWarning");
    expect(snapshot.events.map(item => item.eventType)).toContain("AssessmentFailed");
  });

  test("generates structured deterministic debrief without mutating sources", () => {
    const input = source({ interventionInstances: [{
      instanceId: "O2:1", definitionId: "OXYGEN_THERAPY", definitionVersion: "1", definitionName: "Oxygen",
      encounterId: "PT-12", patientId: "PT-12", status: "COMPLETED", startedAt: 1, endedAt: 60,
      parameters: { flowRateLMin: 15 }, resourceIds: ["MASK"], sourceInterventionId: "O2",
    }] });
    const before = structuredClone(input);
    const first = new ClinicalAssessmentEngine().evaluate(rules, input);
    const second = new ClinicalAssessmentEngine().evaluate([...rules].reverse(), structuredClone(input));
    expect(second).toEqual(first);
    expect(first.debrief.completedInterventions).toHaveLength(1);
    expect(first.debrief.strengths).toContain("Airway secured");
    expect(input).toEqual(before);
  });
});

const fixture: GoldenFixture = {
  fixtureId: "FX-ASSESS", fixtureType: "PROCESS", patientId: "PT-ASSESS", seed: 12,
  clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: [],
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV",
    ventilationReserve: 50, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 },
};
const tick: GoldenInputEvent = { sequenceId: "ASSESS", step: 1, offsetSec: 60, eventType: "ENGINE_TICK",
  actor: "ENGINE", target: "PT-ASSESS", eventId: "TICK", result: "SUCCESS", payload: { tickMin: 1 } };

function replay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine(); engine.reset(fixture);
  engine.setAssessmentRules([{ ruleId: "A", name: "Tick completed", category: "MONITORING", severity: "FAIL",
    condition: { type: "EVENT_PRESENT", eventType: "ENGINE_TICK_APPLIED" }, expectedBehaviour: "Complete an engine tick." }]);
  engine.advanceTo(60); engine.dispatch(tick); return engine;
}

test("WP-12 assessment, debrief, events and replay hash are deterministic", () => {
  const first = replay(); const second = replay();
  expect(first.getAssessmentSnapshot()).toEqual(second.getAssessmentSnapshot());
  expect(first.getAssessmentSnapshot().events).toContainEqual(expect.objectContaining({ eventType: "AssessmentPassed" }));
  expect(first.getAssessmentSnapshot().debrief).toEqual(second.getAssessmentSnapshot().debrief);
  expect(first.getHashes()).toEqual(second.getHashes());
});
