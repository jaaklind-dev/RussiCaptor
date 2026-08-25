import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, terminateHemorrhageAtDeath, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { hemorrhageAssessmentRules } from "@/services/runtime/assessment/HemorrhageAssessmentRules";

const configuration = { baselineBleedingRateMlMin: 100, tourniquetEfficiency: 0.9, binderEfficiency: 0.5,
  infusionOffsetMlMin: 10, bloodProductOffsetMlMin: 25, severityThresholdsMl: [100, 300, 600, 1000] as [number,number,number,number],
  perfusionThresholdsMl: [250, 500, 900] as [number,number,number], compensationThresholdsMl: [400, 800] as [number,number],
  trendThresholdsMlMin: { worsening: 50, improving: 10 } };
const effect = (effectType: ClinicalEffect["effectType"], id: string): ClinicalEffect => ({ effectId: id, effectType,
  encounterId: "PT-H", patientId: "PT-H", timestamp: 60, sourceInterventionInstanceId: id, parameters: {} });

describe("WP-14 Hemorrhage PatientProcess", () => {
  test("progresses deterministically through blood loss, perfusion and compensation", () => {
    const initial = bootstrapHemorrhagePatientProcess("PT-H", { configuration });
    const first = tickHemorrhagePatientProcess(initial, 600);
    expect(first.process.clinicalState).toMatchObject({ cumulativeLossMl: 1000, severity: "CATASTROPHIC", perfusion: "CRITICAL", compensation: "FAILED" });
    expect(first.events.map(e => e.eventType)).toEqual(expect.arrayContaining(["HemorrhageStarted", "PerfusionChanged", "CompensationChanged"]));
  });
  test("resolves tourniquet, binder, infusion and blood effects independent of order", () => {
    const initial = bootstrapHemorrhagePatientProcess("PT-H", { configuration });
    const effects = [effect("REDUCE_EXTERNAL_BLEEDING", "TQ"), effect("PELVIC_STABILIZATION", "PB"),
      effect("INFUSION_RUNNING", "IV"), effect("BLOOD_PRODUCT_STARTED", "BLOOD")];
    const a = tickHemorrhagePatientProcess(setHemorrhageEffects(initial, effects), 60).process;
    const b = tickHemorrhagePatientProcess(setHemorrhageEffects(initial, [...effects].reverse()), 60).process;
    expect(a).toEqual(b); expect(a.clinicalState.bleedingRateMlMin).toBe(0);
  });
  test("STOP_EXTERNAL_BLEEDING wins deterministically", () => {
    const initial = bootstrapHemorrhagePatientProcess("PT-H", { configuration });
    const result = tickHemorrhagePatientProcess(setHemorrhageEffects(initial, [effect("REDUCE_EXTERNAL_BLEEDING", "A"), effect("STOP_EXTERNAL_BLEEDING", "B")]), 60);
    expect(result.process.clinicalState).toMatchObject({ bleedingRateMlMin: 0, activeHemorrhage: false });
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: "HemorrhageStopped" }));
  });
  test("bleeding rate is pressure-independent and changes only through canonical effects", () => {
    const initial = bootstrapHemorrhagePatientProcess("PT-H", { configuration });
    const early = tickHemorrhagePatientProcess(initial, 60).process;
    const late = tickHemorrhagePatientProcess(early, 600).process;
    expect(early.clinicalState.bleedingRateMlMin).toBe(100);
    expect(late.clinicalState.bleedingRateMlMin).toBe(100);
    expect(late.clinicalState.perfusion).not.toBe(early.clinicalState.perfusion);
  });
  test("normalizes a legacy DEAD checkpoint hemorrhage without changing cumulative loss", () => {
    const bleeding = tickHemorrhagePatientProcess(bootstrapHemorrhagePatientProcess("PT-H", { configuration }), 60).process;
    const stopped = terminateHemorrhageAtDeath(bleeding);
    expect(stopped).toMatchObject({state:"Resolved",clinicalState:{cumulativeLossMl:100,estimatedBloodLossMl:100,bleedingRateMlMin:0,activeHemorrhage:false},
      outputs:{runtimeContributions:{cumulativeBloodLossMl:100,bleedingRateMlMin:0}}});
    expect(terminateHemorrhageAtDeath(stopped)).toEqual(stopped);
  });
});

const fixture: GoldenFixture = { fixtureId: "FX-H", fixtureType: "PROCESS", patientId: "PT-H", seed: 14,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: ["HEMORRHAGE_V1"],
  activeResources: { resources: [{ resourceId: "TQ", type: "tourniquet", status: "AVAILABLE", metadata: {} }] },
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV", ventilationReserve: 50,
    reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0, hemorrhage: { configuration } } };
const tick: GoldenInputEvent = { sequenceId: "H", step: 1, offsetSec: 60, eventType: "ENGINE_TICK", actor: "ENGINE", target: "PT-H", eventId: "T", result: "SUCCESS", payload: { tickMin: 1 } };
function replay() { const e = new ClinicalScenarioEngine(); e.reset(fixture); e.setAssessmentRules(hemorrhageAssessmentRules);
  e.scheduleIntervention({ interventionId: "TQ", patientId: "PT-H", resourceId: "TQ", action: "APPLY", timestamp: 60,
    definitionId: "TOURNIQUET_APPLICATION", parameters: { limb: "left", applicationTime: 60 } }); e.advanceTo(60); e.dispatch(tick); return e; }
test("WP-14 Scenario replay, effects, events and assessment are deterministic", () => {
  const a = replay(), b = replay(); const h = a.getPatientProcesses().find(p => p.processType === "HEMORRHAGE");
  expect(h?.outputs.runtimeContributions?.bleedingRateMlMin).toBe(10);
  expect(a.getEventLog()).toContainEqual(expect.objectContaining({ eventType: "HemorrhageReduced" }));
  expect(a.getPatientProcesses()).toEqual(b.getPatientProcesses()); expect(a.getAssessmentSnapshot()).toEqual(b.getAssessmentSnapshot());
  expect(a.getEventLog()).toEqual(b.getEventLog()); expect(a.getHashes()).toEqual(b.getHashes());
});
