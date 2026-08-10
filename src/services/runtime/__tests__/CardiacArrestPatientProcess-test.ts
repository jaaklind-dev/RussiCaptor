import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { CardiacArrestConfiguration } from "@/models/PatientProcessRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import {
  applyCardiacArrestClinicalEffect, applyExplicitCardiacRhythmTransition, bootstrapCardiacArrestPatientProcess, CardiacArrestConfigurationError,
  classifyCardiacRhythm, defaultCardiacArrestConfiguration, tickCardiacArrestPatientProcess,
} from "@/services/runtime/CardiacArrestPatientProcess";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { CARDIAC_ARREST_REFERENCE_FIXTURE, CARDIAC_ARREST_REFERENCE_TICK } from "@/services/golden/CardiacArrestReferenceFixture";

const fixture = { fixtureId: "FX-CARDIAC", patientId: "PT-CARDIAC" };
const effect = (effectId: string, effectType: ClinicalEffect["effectType"]): ClinicalEffect => ({
  effectId, effectType, encounterId: "PT-CARDIAC", patientId: "PT-CARDIAC", timestamp: 0,
  sourceInterventionInstanceId: `I:${effectId}`, parameters: {},
});
const config = (initialRhythm: CardiacArrestConfiguration["initialRhythm"] = "VF"): CardiacArrestConfiguration => ({
  ...structuredClone(defaultCardiacArrestConfiguration), initialRhythm,
  transitions: [{ transitionId: "SHOCK-ROSC", trigger: "SHOCK", fromRhythm: "VF", toRhythm: "PERFUSING", shockAttempt: 1, priority: 100 }],
});

describe("WP-36 Cardiac Arrest PatientProcess", () => {
  test("classifies rhythms and emits contributor-only arrest physiology", () => {
    expect(["VF", "PULSELESS_VT", "PEA", "ASYSTOLE", "PERFUSING"].map(value =>
      classifyCardiacRhythm(value as Parameters<typeof classifyCardiacRhythm>[0]))).toEqual([
      "SHOCKABLE", "SHOCKABLE", "NON_SHOCKABLE", "NON_SHOCKABLE", "PERFUSING",
    ]);
    const process = bootstrapCardiacArrestPatientProcess(fixture, { processId: "CA-1" }, config());
    expect(process.outputs.vitalContributions).toEqual(expect.arrayContaining([
      { vital: "heartRate", operation: "TARGET", value: 0 },
      { vital: "systolicBp", operation: "TARGET", value: 0 },
    ]));
    expect(process.outputs).not.toHaveProperty("hrTargetRange");
    expect(process.outputs).not.toHaveProperty("runtimeContributions");
  });

  test("CPR is idempotent and provides configured partial perfusion", () => {
    const initial = bootstrapCardiacArrestPatientProcess(fixture, {}, config());
    const once = applyCardiacArrestClinicalEffect(initial, effect("CPR-1", "CPR_STARTED"));
    const twice = applyCardiacArrestClinicalEffect(once, effect("CPR-1", "CPR_STARTED"));
    expect(twice).toEqual(once);
    expect(once.clinicalState.cprActive).toBe(true);
    expect(once.outputs.vitalContributions).toEqual(expect.arrayContaining([
      { vital: "heartRate", operation: "TARGET", value: 100 },
      { vital: "systolicBp", operation: "TARGET", value: 40 },
    ]));
    expect(once.pendingEvidence.filter(item => item.eventType === "CPR_STARTED")).toHaveLength(1);
  });

  test("records every defibrillation attempt but only configured shockable transition achieves ROSC", () => {
    const vf = bootstrapCardiacArrestPatientProcess(fixture, {}, config());
    const converted = applyCardiacArrestClinicalEffect(vf, effect("SHOCK-1", "DEFIBRILLATION_ATTEMPT"));
    expect(converted.clinicalState).toMatchObject({ rhythm: "PERFUSING", cardiacState: "ROSC", shockAttemptCount: 1 });
    expect(converted.pendingEvidence.map(item => item.eventType)).toEqual([
      "DEFIBRILLATION_ATTEMPTED", "CARDIAC_RHYTHM_TRANSITION", "ROSC_ACHIEVED",
    ]);
    const pea = bootstrapCardiacArrestPatientProcess(fixture, {}, { ...config("PEA"), transitions: [] });
    const unchanged = applyCardiacArrestClinicalEffect(pea, effect("SHOCK-PEA", "DEFIBRILLATION_ATTEMPT"));
    expect(unchanged.clinicalState).toMatchObject({ rhythm: "PEA", cardiacState: "ARREST", shockAttemptCount: 1 });
    expect(unchanged.pendingEvidence.map(item => item.eventType)).toEqual(["DEFIBRILLATION_ATTEMPTED"]);
  });

  test("time transitions support deterministic re-arrest without completing the patient", () => {
    const configuration: CardiacArrestConfiguration = { ...structuredClone(defaultCardiacArrestConfiguration),
      initialState: "ROSC", initialRhythm: "PERFUSING", transitions: [
        { transitionId: "REARREST", trigger: "TIME", fromRhythm: "PERFUSING", toRhythm: "VF", atSec: 30, priority: 1 },
      ] };
    const result = tickCardiacArrestPatientProcess(bootstrapCardiacArrestPatientProcess(fixture, {}, configuration), 30);
    expect(result.clinicalState).toMatchObject({ cardiacState: "ARREST", rhythm: "VF" });
    expect(result.state).toBe("Active");
    expect(result.pendingEvidence.map(item => item.eventType)).toEqual(["CARDIAC_RHYTHM_TRANSITION", "CARDIAC_REARREST"]);
  });

  test("explicit configured transitions use the same canonical transition path", () => {
    const configuration: CardiacArrestConfiguration = { ...structuredClone(defaultCardiacArrestConfiguration), transitions: [
      { transitionId: "EXPLICIT-ROSC", trigger: "EXPLICIT", fromRhythm: "VF", toRhythm: "PERFUSING", priority: 1 },
    ] };
    const result = applyExplicitCardiacRhythmTransition(bootstrapCardiacArrestPatientProcess(fixture, {}, configuration), "EXPLICIT-ROSC");
    expect(result.clinicalState).toMatchObject({ cardiacState: "ROSC", rhythm: "PERFUSING" });
    expect(result.pendingEvidence.map(item => item.eventType)).toEqual(["CARDIAC_RHYTHM_TRANSITION", "ROSC_ACHIEVED"]);
  });

  test("malformed and ambiguous configurations fail closed with typed diagnostics", () => {
    expect(() => bootstrapCardiacArrestPatientProcess(fixture, {}, { ...config(), transitions: [
      { transitionId: "A", trigger: "SHOCK", fromRhythm: "VF", toRhythm: "PERFUSING", shockAttempt: 1, priority: 1 },
      { transitionId: "B", trigger: "SHOCK", fromRhythm: "VF", toRhythm: "VF", shockAttempt: 1, priority: 1 },
    ] })).toThrow(CardiacArrestConfigurationError);
  });

  test("production lifecycle, intervention effects, events and replay hash are deterministic", () => {
    const fullFixture: GoldenFixture = { fixtureId: "FX-CARDIAC", fixtureType: "PROCESS", patientId: "PT-CARDIAC",
      seed: 36, clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: ["CARDIAC_ARREST_V1"],
      initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-CARDIAC", ventilationReserve: 100,
        reserveLossPerMin: 0, co2Burden: 40, co2GainPerMin: 0, cardiacArrest: { processId: "CA-1", configuration: config() } } };
    const tick: GoldenInputEvent = { sequenceId: "SEQ", step: 1, offsetSec: 1, eventType: "ENGINE_TICK", actor: "ENGINE",
      target: "PT-CARDIAC", eventId: "TICK", result: "SUCCESS", payload: { tickMin: 1 / 60 } };
    const replay = () => { const engine = new ClinicalScenarioEngine(); engine.reset(fullFixture);
      engine.startClinicalIntervention({ sourceInterventionId: "DEFIB-1", definitionId: "DEFIBRILLATION", patientId: "PT-CARDIAC" });
      engine.dispatch(tick); return { state: engine.getRuntimeState(), processes: engine.getPatientProcesses(), events: engine.getEventLog(), hashes: engine.getHashes() }; };
    const first = replay(); const second = replay();
    expect(second).toEqual(first);
    expect(first.processes.find(item => item.processType === "CARDIAC_ARREST")).toMatchObject({ clinicalState: { cardiacState: "ROSC", rhythm: "PERFUSING" } });
    expect(first.events.map(item => item.eventType)).toEqual(expect.arrayContaining(["DEFIBRILLATION_ATTEMPTED", "CARDIAC_RHYTHM_TRANSITION", "ROSC_ACHIEVED"]));
    expect(first.state.globalStatus).toBe("Critical");
  });

  test("establishes the new Cardiac Arrest reference Golden replay", () => {
    const replay = () => { const engine = new ClinicalScenarioEngine(); engine.reset(CARDIAC_ARREST_REFERENCE_FIXTURE);
      engine.advanceTo(30); engine.dispatch(CARDIAC_ARREST_REFERENCE_TICK);
      engine.startClinicalIntervention({ sourceInterventionId: "CPR-REFERENCE", definitionId: "START_CPR", patientId: "PT-CARDIAC-REFERENCE" });
      engine.startClinicalIntervention({ sourceInterventionId: "DEFIB-REFERENCE", definitionId: "DEFIBRILLATION", patientId: "PT-CARDIAC-REFERENCE" });
      engine.dispatch({ ...CARDIAC_ARREST_REFERENCE_TICK, eventId: "TICK-CARDIAC-INTERVENTIONS", step: 2 });
      return engine; };
    const first = replay(); const second = replay();
    expect(second.getHashes()).toEqual(first.getHashes());
    expect(second.getEventLog()).toEqual(first.getEventLog());
    expect(first.getHashes().replayHash).toBe("e0edb913c2c0e8df32156f8e7efe5e727bc78dcfb018668f44437249011e5751");
  });
});
