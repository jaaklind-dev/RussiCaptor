import { VitalSignEngine, defaultVitalSignConfiguration } from "@/services/runtime/vitals/VitalSignEngine";
import type { VitalSignContributor, VitalSignResolutionInput } from "@/models/VitalSign";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { vitalSignAssessmentRules } from "@/services/runtime/assessment/VitalSignAssessmentRules";

const engine = new VitalSignEngine();
const contributor = (overrides: Partial<VitalSignContributor>): VitalSignContributor => ({
  contributorId: "C-1", sourceType: "PATIENT_PROCESS", sourceId: "PROCESS-1",
  layer: "PROCESS", vital: "heartRate", operation: "DELTA", value: 0, ...overrides,
});

const fixture: GoldenFixture = {
  fixtureId: "FX-VITALS", fixtureType: "PROCESS", patientId: "PT-VITALS", seed: 16,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: [], activeResources: {},
  initialState: {
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV", ventilationReserve: 50,
    reserveLossPerMin: 1, co2Burden: 42, co2GainPerMin: 2,
    baselineVitals: { hr: 72, sbp: 118, dbp: 70, rr: 14, spo2: 99, etco2: 38, temperature: 36.6, gcs: 15 },
  },
};
const tick = (id: string, offsetSec: number): GoldenInputEvent => ({ sequenceId: "V", step: offsetSec, offsetSec,
  eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-VITALS", eventId: id, result: "SUCCESS", payload: { tickMin: 1 } });
function scenarioReplay() {
  const scenario = new ClinicalScenarioEngine(); scenario.reset(fixture); scenario.setAssessmentRules(vitalSignAssessmentRules);
  scenario.advanceTo(60); scenario.dispatch(tick("V-1", 60));
  scenario.advanceTo(120); scenario.dispatch(tick("V-2", 120));
  return scenario;
}

test("WP-16 scenario replay reproduces monitor, events, assessment and hash", () => {
  const first = scenarioReplay(); const second = scenarioReplay();
  expect(first.getRuntimeState().vitalSignState?.baseline.heartRate).toBe(72);
  expect(first.getRuntimeState().vitalSignState?.readings.etco2.target).toBe(46);
  expect(first.getVitalSignEvents()).toEqual(second.getVitalSignEvents());
  expect(first.getRuntimeState()).toEqual(second.getRuntimeState());
  expect(first.getAssessmentSnapshot()).toEqual(second.getAssessmentSnapshot());
  expect(first.getHashes()).toEqual(second.getHashes());
});
const resolve = (contributors: VitalSignContributor[] = [], overrides: Partial<VitalSignResolutionInput> = {}) => engine.resolve({
  timestamp: 0, configuration: structuredClone(defaultVitalSignConfiguration), contributors, ...overrides,
});

describe("WP-16 VitalSignEngine", () => {
  test("generates configured baseline and derived values", () => {
    const result = resolve();
    expect(result.state.readings.heartRate.current).toBe(80);
    expect(result.state.derived).toEqual({ meanArterialPressure: 90, shockIndex: 0.667, pulsePressure: 45 });
    expect(result.state.avpu).toBe("ALERT");
  });

  test("applies one process modifier", () => {
    expect(resolve([contributor({ value: 18 })]).state.readings.heartRate.target).toBe(98);
  });

  test("aggregates multiple processes independently of input order", () => {
    const values = [contributor({ contributorId: "B", sourceId: "B", value: 8 }), contributor({ contributorId: "A", sourceId: "A", value: 10 })];
    expect(resolve(values).state).toEqual(resolve([...values].reverse()).state);
  });

  test("applies medication after process target and before temporary modifiers", () => {
    const values = [
      contributor({ contributorId: "P", operation: "TARGET", value: 100 }),
      contributor({ contributorId: "M", sourceType: "CLINICAL_EFFECT", sourceId: "MED-1", layer: "MEDICATION", value: -10 }),
      contributor({ contributorId: "T", sourceId: "TEMP-1", layer: "TEMPORARY", value: 5 }),
    ];
    expect(resolve(values).state.readings.heartRate.target).toBe(95);
  });

  test("enforces configured limits and maximum change per tick", () => {
    const first = resolve();
    const next = resolve([contributor({ operation: "TARGET", value: 999 })], { timestamp: 1, previous: first.state });
    expect(next.state.readings.heartRate.target).toBe(220);
    expect(next.state.readings.heartRate.current).toBe(105);
  });

  test("calculates trends and deterministic events", () => {
    const first = resolve();
    const input = { timestamp: 1, previous: first.state };
    const a = resolve([contributor({ value: 20 })], input);
    const b = resolve([contributor({ value: 20 })], input);
    expect(a).toEqual(b);
    expect(a.state.readings.heartRate.direction).toBe("RISING");
    expect(a.events).toContainEqual(expect.objectContaining({ eventType: "VitalSignChanged", vital: "heartRate" }));
    expect(a.events).toContainEqual(expect.objectContaining({ eventType: "TrendChanged", vital: "heartRate" }));
  });

  test("changes monitor quality without changing clinical targets", () => {
    const first = resolve();
    const next = resolve([], { timestamp: 1, previous: first.state, monitorQuality: "OFFLINE" });
    expect(next.state.readings).toEqual(first.state.readings);
    expect(next.events).toContainEqual(expect.objectContaining({ eventType: "MonitorStateChanged", to: "OFFLINE" }));
  });
});
