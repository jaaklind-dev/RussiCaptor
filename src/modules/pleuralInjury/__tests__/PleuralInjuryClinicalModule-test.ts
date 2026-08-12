import fs from "node:fs";
import path from "node:path";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { alsClinicalModule } from "@/modules/als/AlsClinicalModule";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { pelvicInjuryClinicalModule } from "@/modules/pelvicInjury/PelvicInjuryClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { traumaCoreClinicalModule } from "@/modules/traumaCore/TraumaCoreClinicalModule";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { PLEURAL_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { bootstrapPleuralInjuryPatientProcess, applyPleuralEffects, tickPleuralInjuryPatientProcess } from "@/services/runtime/PleuralInjuryPatientProcess";
import { pleuralInjuryClinicalModule } from "../PleuralInjuryClinicalModule";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "../PleuralInjuryManifest";
import { PLEURAL_INJURY_REFERENCE } from "../PleuralInjuryReference";

const modules = [traumaCoreClinicalModule, airwayClinicalModule, cardiacArrestClinicalModule, medicationCoreClinicalModule, respiratoryFailureClinicalModule, alsClinicalModule, pelvicInjuryClinicalModule, pleuralInjuryClinicalModule];
const dependency = (moduleId: string) => ({ moduleId, version: "1.0.0" });

describe("WP-44 pleural injury and massive hemopneumothorax", () => {
  test("publishes immutable deterministic module and reference package", () => {
    expect(Object.isFrozen(pleuralInjuryClinicalModule)).toBe(true);
    expect(pleuralInjuryClinicalModule.registrations).toMatchObject({ patientProcesses: ["PLEURAL_INJURY"], clinicalEffects: ["PLEURAL_DRAINAGE"], interventions: ["CHEST_DRAIN_INSERTION"] });
    expect(clinicalModuleRegistry.require(PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION)).toEqual(pleuralInjuryClinicalModule);
    const published = exercisePackageRegistry.require(PLEURAL_INJURY_EXERCISE_PACKAGE.packageId, PLEURAL_INJURY_EXERCISE_PACKAGE.packageVersion);
    expect(published.requiredClinicalModules).toEqual([dependency(PLEURAL_INJURY_MODULE_ID)]);
    expect(published.definition.clinicalModuleComposition?.modules).toEqual(expect.arrayContaining([expect.objectContaining({ moduleId: PLEURAL_INJURY_MODULE_ID })]));
  });

  test("composes deterministically with trauma, ALS and pelvic modules without duplicate ownership", () => {
    const base: ExerciseDefinition = Object.freeze({ definitionVersion: 1, exerciseTypeId: "WP44", name: "WP-44", description: "Pleural composition", profile: "TRAUMA", enabledPatientProcesses: Object.freeze([]), enabledAnalyticsProviders: Object.freeze([]), enabledMetricProviders: Object.freeze([]), objectives: Object.freeze([]), capabilities: Object.freeze([]) });
    const compose = (values: typeof modules) => { const registry = new ClinicalModuleRegistry(); values.forEach(module => registry.register(module));
      return new ClinicalModuleComposer(registry).compose(base, [dependency(PLEURAL_INJURY_MODULE_ID), dependency("ALS_V1"), dependency("PELVIC_INJURY_V1")]); };
    expect(compose(modules)).toMatchObject({ ok: true });
    expect(compose([...modules].reverse())).toEqual(compose(modules));
  });

  test("tracks pleural air and blood separately and makes drainage idempotent", () => {
    const initial = bootstrapPleuralInjuryPatientProcess("PT-P", PLEURAL_INJURY_REFERENCE.pleuralInjury);
    const progressed = tickPleuralInjuryPatientProcess(initial, 60);
    const effect = { effectId: "DRAIN-1", effectType: "PLEURAL_DRAINAGE" as const, encounterId: "PT-P", patientId: "PT-P", timestamp: 60, sourceInterventionInstanceId: "DRAIN", parameters: {} };
    const drained = applyPleuralEffects(progressed, [effect]);
    expect(progressed.clinicalState.airBurden).toBeGreaterThan(initial.clinicalState.airBurden);
    expect(progressed.clinicalState.bloodBurdenMl).toBeGreaterThan(initial.clinicalState.bloodBurdenMl);
    expect(drained.clinicalState).toMatchObject({ drainageActive: true, appliedEffectIds: ["DRAIN-1"] });
    expect(applyPleuralEffects(drained, [effect])).toEqual(drained);
    expect(tickPleuralInjuryPatientProcess(drained, 60).clinicalState.airBurden - drained.clinicalState.airBurden).toBeLessThan(4);
  });

  test("runs pleural, respiratory failure, hypoxia and thoracic hemorrhage through canonical lifecycle", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(fixture()); engine.advanceTo(60); engine.dispatch(tick(1, 60));
    const processes = engine.getPatientProcesses();
    expect(processes.map(item => item.processType)).toEqual(expect.arrayContaining(["PLEURAL_INJURY", "RESPIRATORY_FAILURE", "HYPOXIA", "HEMORRHAGE"]));
    const hemorrhage = processes.find(item => item.processType === "HEMORRHAGE");
    expect(hemorrhage).toMatchObject({ sourceId: "THORACIC_1", outputs: { runtimeContributions: { bleedingRateMlMin: 120 } } });
    expect(engine.getRuntimeState().vitalSignState?.readings).toMatchObject({ spo2: expect.any(Object), respiratoryRate: expect.any(Object), etco2: expect.any(Object), heartRate: expect.any(Object), systolicBp: expect.any(Object) });
  });

  test("chest drain reduces pleural respiratory burden but does not stop thoracic hemorrhage or restore blood", () => {
    const engine = new ClinicalScenarioEngine(); engine.reset(fixture());
    engine.scheduleIntervention({ interventionId: "CD-APPLY", patientId: "PT-PLEURAL", resourceId: "CD-1", action: "APPLY", timestamp: 120, definitionId: "CHEST_DRAIN_INSERTION" });
    engine.advanceTo(60); engine.dispatch(tick(1, 60));
    const before = engine.getPatientProcesses();
    const bloodBefore = Number(before.find(item => item.processType === "HEMORRHAGE")?.outputs.runtimeContributions?.cumulativeBloodLossMl);
    engine.advanceTo(120); engine.dispatch(tick(2, 120));
    const after = engine.getPatientProcesses();
    const pleural = after.find(item => item.processType === "PLEURAL_INJURY");
    const hemorrhage = after.find(item => item.processType === "HEMORRHAGE");
    expect(pleural?.outputs.runtimeContributions).toMatchObject({ pleuralDrainageActive: true });
    expect(Number(hemorrhage?.outputs.runtimeContributions?.cumulativeBloodLossMl)).toBeGreaterThan(bloodBefore);
    expect(hemorrhage?.outputs.runtimeContributions?.bleedingRateMlMin).toBe(120);
    expect(engine.getEventLog()).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "ClinicalEffectApplied", payload: expect.objectContaining({ effectType: "PLEURAL_DRAINAGE" }) })]));
  });

  test("replay is bit-for-bit deterministic and keeps patient isolation", () => {
    const replay = (patientId = "PT-PLEURAL") => { const engine = new ClinicalScenarioEngine(); engine.reset(fixture(patientId));
      engine.advanceTo(60); engine.dispatch(tick(1, 60, patientId)); engine.scheduleIntervention({ interventionId: "CD", patientId, resourceId: "CD-1", action: "APPLY", timestamp: 120, definitionId: "CHEST_DRAIN_INSERTION" });
      engine.advanceTo(120); engine.dispatch(tick(2, 120, patientId)); return { state: engine.getRuntimeState(), processes: engine.getPatientProcesses(), events: engine.getEventLog(), hashes: engine.getHashes() }; };
    const first = replay(); expect(replay()).toEqual(first); expect(first.hashes.replayHash).toBe("44f3b5238b60f27418da1c764a70a34ef0f386a51a459ac59cf2f7d7e282bb19");
    const other = replay("PT-PLEURAL-OTHER"); expect(other.state.encounterId).toBe("PT-PLEURAL-OTHER"); expect(other.events.every(event => event.target !== "PT-PLEURAL")).toBe(true);
  });

  test("adds no pleural conditional branch to ScenarioEngine", () => {
    const scenario = fs.readFileSync(path.join(process.cwd(), "src/services/ScenarioEngine.ts"), "utf8");
    expect(scenario).not.toMatch(/if\s*\([^)]*PLEURAL|switch\s*\([^)]*PLEURAL/);
  });
});

function fixture(patientId = "PT-PLEURAL"): GoldenFixture {
  return { fixtureId: `FX-WP44-${patientId}`, fixtureType: "PROCESS", patientId, seed: 44, clockState: "RUNNING", ownershipVersion: 1,
    loadedModules: [PLEURAL_INJURY_MODULE_ID, "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1"], activeResources: { resources: [{ resourceId: "CD-1", type: "chestDrain", status: "AVAILABLE", metadata: {} }] },
    initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
      pleuralInjury: { ...PLEURAL_INJURY_REFERENCE.pleuralInjury, processId: `${patientId}:PLEURAL:1`, instanceKey: `${patientId}:pleural:1` },
      respiratoryFailure: { ...PLEURAL_INJURY_REFERENCE.respiratoryFailure, processId: `${patientId}:RF:1`, instanceKey: `${patientId}:rf:1` },
      hypoxia: { ...PLEURAL_INJURY_REFERENCE.hypoxia, processId: `${patientId}:HYP:1`, instanceKey: `${patientId}:hyp:1` },
      hemorrhageSources: PLEURAL_INJURY_REFERENCE.hemorrhageSources.map(item => ({ ...item, processId: `${patientId}:HEM:THORACIC_1`, instanceKey: `${patientId}:hem:thoracic` })) } };
}
function tick(step: number, offsetSec: number, patientId = "PT-PLEURAL"): GoldenInputEvent { return { sequenceId: "WP44", step, offsetSec, eventType: "ENGINE_TICK", actor: "ENGINE", target: patientId, eventId: `WP44-${patientId}-${step}`, result: "SUCCESS", payload: { tickMin: 1 } }; }
