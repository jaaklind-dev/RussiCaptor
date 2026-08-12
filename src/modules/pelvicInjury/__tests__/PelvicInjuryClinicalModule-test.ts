import fs from "node:fs";
import path from "node:path";
import type { ClinicalEffect } from "@/models/ClinicalIntegration";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { alsClinicalModule } from "@/modules/als/AlsClinicalModule";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { traumaCoreClinicalModule } from "@/modules/traumaCore/TraumaCoreClinicalModule";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { PELVIC_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from "@/services/runtime/HemorrhagePatientProcess";
import { pelvicInjuryClinicalModule } from "../PelvicInjuryClinicalModule";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION, pelvicInjuryManifest } from "../PelvicInjuryManifest";
import { OPEN_BOOK_PELVIC_INJURY, PELVIC_HEMORRHAGE_REFERENCE_SOURCE, PELVIC_INJURY_REFERENCE_PATIENT } from "../PelvicInjuryReference";
import { pelvicInjuryRegistrations } from "../PelvicInjuryRegistrations";

const base: ExerciseDefinition = Object.freeze({ definitionVersion: 1, exerciseTypeId: "WP43", name: "WP-43", description: "Pelvic injury", profile: "TRAUMA", enabledPatientProcesses: Object.freeze([]), enabledAnalyticsProviders: Object.freeze([]), enabledMetricProviders: Object.freeze([]), objectives: Object.freeze([]), capabilities: Object.freeze([]) });
const modules = [traumaCoreClinicalModule, airwayClinicalModule, cardiacArrestClinicalModule, medicationCoreClinicalModule, respiratoryFailureClinicalModule, alsClinicalModule, pelvicInjuryClinicalModule];
const compose = (roots: readonly { moduleId: string; version: string }[], values = modules) => {
  const registry = new ClinicalModuleRegistry(); values.forEach(module => registry.register(module));
  return new ClinicalModuleComposer(registry).compose(base, roots);
};
const dependency = (moduleId: string) => ({ moduleId, version: "1.0.0" });

const pelvicEffect = (id = "PB-1"): ClinicalEffect => ({ effectId: id, effectType: "PELVIC_STABILIZATION", encounterId: "PT-PELVIC", patientId: "PT-PELVIC", timestamp: 60, sourceInterventionInstanceId: id, parameters: {} });

describe("WP-43 Pelvic Hemorrhage / Open-Book Injury", () => {
  test("publishes an immutable module, exact TRAUMA_CORE dependency and deterministic hash", () => {
    expect(pelvicInjuryManifest).toEqual(expect.objectContaining({ moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION, dependencies: [dependency("TRAUMA_CORE_V1")] }));
    expect(Object.isFrozen(pelvicInjuryClinicalModule)).toBe(true);
    expect(Object.isFrozen(PELVIC_HEMORRHAGE_REFERENCE_SOURCE.configuration.vitalResponsePer1000Ml)).toBe(true);
    expect(PELVIC_INJURY_REFERENCE_PATIENT).toMatchObject({ patientId: "PT-PELVIC-001", mechanism: "FALL_FROM_HEIGHT", injuries: [OPEN_BOOK_PELVIC_INJURY], hemorrhageSources: [PELVIC_HEMORRHAGE_REFERENCE_SOURCE] });
    expect(createClinicalModule({ moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION, manifest: { description: pelvicInjuryManifest.description, dependencies: pelvicInjuryManifest.dependencies, compatibilityVersion: pelvicInjuryManifest.compatibilityVersion }, registrations: pelvicInjuryRegistrations }).moduleHash).toBe(pelvicInjuryClinicalModule.moduleHash);
    expect(OPEN_BOOK_PELVIC_INJURY).toMatchObject({ injuryType: "OPEN_BOOK_PELVIC_INJURY", mechanism: "FALL_FROM_HEIGHT", anatomicRegion: "PELVIS", woundClassification: "CLOSED", provenance: { moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION } });
  });

  test.each([
    ["alone", [dependency(PELVIC_INJURY_MODULE_ID)]],
    ["with airway", [dependency(PELVIC_INJURY_MODULE_ID), dependency("AIRWAY_V1")]],
    ["with ALS", [dependency(PELVIC_INJURY_MODULE_ID), dependency("ALS_V1")]],
  ])("composes %s without duplicate ownership", (_name, roots) => {
    expect(compose(roots)).toMatchObject({ ok: true });
    expect(compose([...roots].reverse(), [...modules].reverse())).toEqual(compose(roots));
  });

  test("registers a reference package with canonical provenance", () => {
    expect(clinicalModuleRegistry.require(PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION)).toEqual(pelvicInjuryClinicalModule);
    const published = exercisePackageRegistry.require(PELVIC_INJURY_EXERCISE_PACKAGE.packageId, PELVIC_INJURY_EXERCISE_PACKAGE.packageVersion);
    expect(published.requiredClinicalModules).toEqual([dependency(PELVIC_INJURY_MODULE_ID)]);
    expect(published.definition.clinicalModuleComposition?.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ moduleId: "TRAUMA_CORE_V1", version: "1.0.0" }),
      expect.objectContaining({ moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION, moduleHash: pelvicInjuryClinicalModule.moduleHash }),
    ]));
  });

  test("models progressive pelvic blood loss and binder response without retroactive correction", () => {
    const initial = bootstrapHemorrhagePatientProcess("PT-PELVIC", PELVIC_HEMORRHAGE_REFERENCE_SOURCE);
    const before = tickHemorrhagePatientProcess(initial, 300).process;
    const controlled = setHemorrhageEffects(before, [pelvicEffect()]);
    const after = tickHemorrhagePatientProcess(controlled, 60).process;
    expect(before.clinicalState).toMatchObject({ cumulativeLossMl: 700, bleedingRateMlMin: 140, severity: "MODERATE" });
    expect(after.clinicalState.cumulativeLossMl).toBe(756);
    expect(after.clinicalState.bleedingRateMlMin).toBe(56);
    expect(after.outputs.vitalContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ vital: "heartRate", operation: "DELTA" }),
      expect.objectContaining({ vital: "systolicBp", operation: "DELTA" }),
      expect.objectContaining({ vital: "crt", operation: "DELTA" }),
    ]));
    expect(setHemorrhageEffects(before, [pelvicEffect(), pelvicEffect()])).toEqual(setHemorrhageEffects(before, [pelvicEffect()]));
  });

  test("keeps multiple bleeding sources independently addressable", () => {
    const pelvic = bootstrapHemorrhagePatientProcess("PT-PELVIC", PELVIC_HEMORRHAGE_REFERENCE_SOURCE);
    const secondary = bootstrapHemorrhagePatientProcess("PT-PELVIC", { ...PELVIC_HEMORRHAGE_REFERENCE_SOURCE, processId: "PT-PELVIC:HEMORRHAGE:SECONDARY", instanceKey: "PT-PELVIC:hemorrhage:secondary", sourceId: "SECONDARY", sourceType: "EXTERNAL" });
    expect(setHemorrhageEffects(pelvic, [pelvicEffect()]).clinicalState.activeEffects).toHaveLength(1);
    expect(setHemorrhageEffects(secondary, [pelvicEffect()]).clinicalState.activeEffects).toHaveLength(0);
    expect(pelvic.instanceKey).not.toBe(secondary.instanceKey);
  });

  test("bootstraps and aggregates multiple sources in stable process order", () => {
    const source = fixture();
    const secondaryConfiguration = { ...PELVIC_HEMORRHAGE_REFERENCE_SOURCE.configuration, baselineBleedingRateMlMin: 40, binderEfficiency: 0 };
    const initialState = source.initialState as Record<string, unknown>;
    const engine = new ClinicalScenarioEngine();
    engine.reset({ ...source, initialState: { ...initialState, hemorrhageSources: [
      { ...PELVIC_HEMORRHAGE_REFERENCE_SOURCE, processId: "PT-PELVIC:HEMORRHAGE:PELVIC", instanceKey: "PT-PELVIC:hemorrhage:pelvic" },
      { processId: "PT-PELVIC:HEMORRHAGE:SECONDARY", instanceKey: "PT-PELVIC:hemorrhage:secondary", sourceId: "SECONDARY", sourceType: "EXTERNAL", templateId: "SECONDARY_TEST", configuration: secondaryConfiguration },
    ].reverse() } });
    engine.scheduleIntervention({ interventionId: "PB-MULTI", patientId: "PT-PELVIC", resourceId: "PB-1", action: "APPLY", timestamp: 60, definitionId: "PELVIC_BINDER_APPLICATION", parameters: {} });
    engine.advanceTo(60); engine.dispatch(tick(1, 60));
    const hemorrhages = engine.getPatientProcesses().filter(process => process.processType === "HEMORRHAGE");
    expect(hemorrhages.map(process => process.processId)).toEqual(["PT-PELVIC:HEMORRHAGE:PELVIC", "PT-PELVIC:HEMORRHAGE:SECONDARY"]);
    expect(hemorrhages.map(process => process.outputs.runtimeContributions?.bleedingRateMlMin)).toEqual([56, 40]);
    expect(hemorrhages.reduce((sum, process) => sum + Number(process.outputs.runtimeContributions?.cumulativeBloodLossMl), 0)).toBe(96);
  });

  test("replays binder intervention, source lifecycle, vitals and events deterministically", () => {
    const replay = (patientId = "PT-PELVIC") => {
      const engine = new ClinicalScenarioEngine(); engine.reset(fixture(patientId));
      engine.scheduleIntervention({ interventionId: "PB-APPLY", patientId, resourceId: "PB-1", action: "APPLY", timestamp: 120, definitionId: "PELVIC_BINDER_APPLICATION", parameters: {} });
      engine.advanceTo(60); engine.dispatch(tick(1, 60, patientId));
      engine.advanceTo(120); engine.dispatch(tick(2, 120, patientId));
      return { state: engine.getRuntimeState(), processes: engine.getPatientProcesses(), events: engine.getEventLog(), hashes: engine.getHashes() };
    };
    const first = replay(); const second = replay();
    const hemorrhage = first.processes.find(process => process.processType === "HEMORRHAGE");
    expect(hemorrhage?.outputs.runtimeContributions?.bleedingRateMlMin).toBe(56);
    expect(first.events.map(event => event.eventType)).toEqual(expect.arrayContaining(["PelvicBinderApplied", "HemorrhageReduced"]));
    expect(first.hashes.replayHash).toBe("2eb0288fbf8baeb78135cc476266ae3d7d31c0f09cce8fa39848a87b2fb55142");
    expect(first.events.filter(event => ["PelvicBinderApplied", "HemorrhageReduced"].includes(event.eventType))).toEqual([
      expect.objectContaining({ eventType: "PelvicBinderApplied", target: "PT-PELVIC", simulationTime: 120 }),
      expect.objectContaining({ eventType: "HemorrhageReduced", target: "PT-PELVIC", simulationTime: 120, payload: expect.objectContaining({ sourceProcessId: "PT-PELVIC:HEMORRHAGE:PELVIC_HEMORRHAGE_1" }) }),
    ]);
    expect(first.processes.map(process => process.processType)).toEqual(expect.arrayContaining(["HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "HEMORRHAGE"]));
    expect(first).toEqual(second);
    const other = replay("PT-CONTROL");
    expect(other.state.encounterId).toBe("PT-CONTROL");
    expect(other.events.every(event => event.target !== "PT-PELVIC")).toBe(true);
  });

  test("does not fabricate hemorrhage when a binder is applied without a configured source", () => {
    const source = fixture("PT-NO-HEM");
    const engine = new ClinicalScenarioEngine();
    engine.reset({ ...source, initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 } });
    engine.scheduleIntervention({ interventionId: "PB-NO-HEM", patientId: "PT-NO-HEM", resourceId: "PB-1", action: "APPLY", timestamp: 60, definitionId: "PELVIC_BINDER_APPLICATION", parameters: {} });
    engine.advanceTo(60); engine.dispatch(tick(1, 60, "PT-NO-HEM"));
    expect(engine.getPatientProcesses().some(process => process.processType === "HEMORRHAGE")).toBe(false);
    expect(engine.getEventLog()).toContainEqual(expect.objectContaining({ eventType: "PelvicBinderApplied", target: "PT-NO-HEM" }));
  });

  test("does not add a pelvic branch to ScenarioEngine or a new runtime layer", () => {
    const root = process.cwd();
    const scenario = fs.readFileSync(path.join(root, "src/services/ScenarioEngine.ts"), "utf8");
    expect(scenario).not.toMatch(/PELVIC_INJURY|OPEN_BOOK_PELVIC_INJURY/);
  });
});

function fixture(patientId = "PT-PELVIC"): GoldenFixture {
  const pelvicSource = { ...PELVIC_HEMORRHAGE_REFERENCE_SOURCE, processId: `${patientId}:HEMORRHAGE:PELVIC_HEMORRHAGE_1`, instanceKey: `${patientId}:hemorrhage:pelvic` };
  return { fixtureId: `FX-WP43-${patientId}`, fixtureType: "PROCESS", patientId, seed: 43, clockState: "RUNNING", ownershipVersion: 1, loadedModules: [PELVIC_INJURY_MODULE_ID, "HYPOXIA_V1"], activeResources: { resources: [{ resourceId: "PB-1", type: "pelvicBinder", status: "AVAILABLE", metadata: {} }] }, initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0, hypoxia: { templateId: "HYP-CONTROL", oxygenationReserve: 75, spo2: 94, reserveLossPerMin: 0 }, hemorrhageSources: [pelvicSource] } };
}

function tick(step: number, offsetSec: number, patientId = "PT-PELVIC"): GoldenInputEvent {
  return { sequenceId: "WP43", step, offsetSec, eventType: "ENGINE_TICK", actor: "ENGINE", target: patientId, eventId: `WP43-T${step}`, result: "SUCCESS", payload: { tickMin: 1 } };
}
