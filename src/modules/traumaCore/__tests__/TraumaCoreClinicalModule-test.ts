import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { alsClinicalModule } from "@/modules/als/AlsClinicalModule";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { TRAUMA_CORE_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { createTraumaticInjuryDescriptor } from "@/models/trauma/TraumaticInjury";
import { traumaCoreClinicalModule } from "../TraumaCoreClinicalModule";
import { TRAUMA_CORE_CAPABILITY_STATUS, TRAUMA_INTERVENTION_BOUNDARIES } from "../TraumaCoreCapabilityStatus";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION, traumaCoreManifest } from "../TraumaCoreManifest";
import { traumaCoreRegistrations } from "../TraumaCoreRegistrations";
import fs from "node:fs";
import path from "node:path";

const modules = [airwayClinicalModule, cardiacArrestClinicalModule, medicationCoreClinicalModule, respiratoryFailureClinicalModule, alsClinicalModule, traumaCoreClinicalModule];
const base: ExerciseDefinition = Object.freeze({ definitionVersion: 1, exerciseTypeId: "WP42", name: "WP-42", description: "Foundation test", profile: "CUSTOM", enabledPatientProcesses: Object.freeze([]), enabledAnalyticsProviders: Object.freeze([]), enabledMetricProviders: Object.freeze([]), objectives: Object.freeze([]), capabilities: Object.freeze([]) });
const registry = (values = modules) => { const result = new ClinicalModuleRegistry(); values.forEach(module => result.register(module)); return result; };
const compose = (required: readonly { moduleId: string; version: string }[], values = modules) => new ClinicalModuleComposer(registry(values)).compose(base, required);
const dependency = (moduleId: string, version = "1.0.0") => ({ moduleId, version });

describe("WP-42 Trauma Core Clinical Module foundation", () => {
  test("publishes a recursively immutable dependency-free foundation module and injury descriptor", () => {
    expect(traumaCoreManifest).toEqual({ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION, description: expect.any(String), dependencies: [], compatibilityVersion: 1 });
    expect(traumaCoreClinicalModule.moduleHash).toHaveLength(64);
    expect(createClinicalModule({ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION, manifest: { description: traumaCoreManifest.description, dependencies: traumaCoreManifest.dependencies, compatibilityVersion: 1 }, registrations: traumaCoreRegistrations }).moduleHash).toBe(traumaCoreClinicalModule.moduleHash);
    expect(Object.isFrozen(traumaCoreClinicalModule)).toBe(true);
    expect(Object.isFrozen(traumaCoreClinicalModule.registrations.validationRules)).toBe(true);
    const injury = createTraumaticInjuryDescriptor({ injuryId: "INJ-1", mechanism: "FALL_FROM_HEIGHT", anatomicRegion: "PELVIS", woundClassification: "CLOSED" });
    expect(injury).toEqual(expect.objectContaining({ mechanism: "FALL_FROM_HEIGHT", anatomicRegion: "PELVIS" }));
    expect(Object.isFrozen(injury)).toBe(true);
  });

  test("does not advertise injury physiology or injury-specific intervention effects", () => {
    expect(traumaCoreClinicalModule.registrations.patientProcesses).toEqual([]);
    expect(traumaCoreClinicalModule.registrations.clinicalEffects).toEqual([]);
    expect(traumaCoreClinicalModule.registrations.interventions).toEqual([]);
    expect(TRAUMA_CORE_CAPABILITY_STATUS).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "PELVIC_HEMORRHAGE", status: "NOT_IMPLEMENTED" }),
      expect.objectContaining({ capabilityId: "HEMOPNEUMOTHORAX", status: "NOT_IMPLEMENTED" }),
    ]));
    expect(TRAUMA_INTERVENTION_BOUNDARIES.PELVIC_BINDER).toMatchObject({ owner: "CORE_RUNTIME", status: "PARTIAL" });
    expect(TRAUMA_INTERVENTION_BOUNDARIES.CHEST_DRAIN.status).toBe("NOT_IMPLEMENTED");
  });

  test.each([
    ["TRAUMA_CORE alone", [dependency(TRAUMA_CORE_MODULE_ID)]],
    ["TRAUMA_CORE + AIRWAY", [dependency(TRAUMA_CORE_MODULE_ID), dependency("AIRWAY_V1")]],
    ["TRAUMA_CORE + RESPIRATORY_FAILURE", [dependency(TRAUMA_CORE_MODULE_ID), dependency("RESPIRATORY_FAILURE_V1")]],
    ["TRAUMA_CORE + MEDICATION_CORE", [dependency(TRAUMA_CORE_MODULE_ID), dependency("MEDICATION_CORE_V1")]],
    ["TRAUMA_CORE + ALS", [dependency(TRAUMA_CORE_MODULE_ID), dependency("ALS_V1")]],
    ["TRAUMA_CORE + RESPIRATORY_FAILURE + ALS", [dependency(TRAUMA_CORE_MODULE_ID), dependency("RESPIRATORY_FAILURE_V1"), dependency("ALS_V1")]],
  ])("composes %s without duplicate ownership", (_name, required) => {
    const result = compose(required); expect(result.ok).toBe(true);
  });

  test("is invariant to root and registry permutations", () => {
    const required = [dependency("ALS_V1"), dependency(TRAUMA_CORE_MODULE_ID), dependency("RESPIRATORY_FAILURE_V1")];
    const first = compose(required); const second = compose([...required].reverse(), [...modules].reverse());
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    if (first.ok) expect(first.composition.modules.map(item => item.moduleId)).toEqual(["AIRWAY_V1", "CARDIAC_ARREST_V1", "MEDICATION_CORE_V1", "ALS_V1", "RESPIRATORY_FAILURE_V1", TRAUMA_CORE_MODULE_ID]);
  });

  test("fails closed for missing dependency, version mismatch, cycle and registration collision", () => {
    expect(compose([dependency(TRAUMA_CORE_MODULE_ID)], modules.filter(module => module.moduleId !== TRAUMA_CORE_MODULE_ID))).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "MISSING_DEPENDENCY" })] });
    expect(compose([dependency(TRAUMA_CORE_MODULE_ID, "2.0.0")])).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "VERSION_MISMATCH" })] });
    const registrations: ClinicalModuleRegistrations = { patientProcesses: [], clinicalEffects: [], interventions: [], medications: [], assessmentRules: [], analyticsProviders: [], metricProviders: [], capabilities: [], objectives: [], validationRules: ["TRAUMATIC_INJURY_DESCRIPTOR_V1"] };
    const collision = createClinicalModule({ moduleId: "COLLISION", version: "1.0.0", manifest: { description: "Collision", dependencies: [], compatibilityVersion: 1 }, registrations });
    expect(compose([dependency(TRAUMA_CORE_MODULE_ID), dependency("COLLISION")], [...modules, collision])).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "DUPLICATE_VALIDATION_RULE" })] });
    const cyclicTrauma = createClinicalModule({ moduleId: "CYCLE_A", version: "1.0.0", manifest: { description: "A", dependencies: [dependency("CYCLE_B")], compatibilityVersion: 1 }, registrations: { ...registrations, validationRules: [] } });
    const cyclicPeer = createClinicalModule({ moduleId: "CYCLE_B", version: "1.0.0", manifest: { description: "B", dependencies: [dependency("CYCLE_A")], compatibilityVersion: 1 }, registrations: { ...registrations, validationRules: [] } });
    expect(compose([dependency("CYCLE_A")], [...modules, cyclicTrauma, cyclicPeer])).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "CYCLIC_DEPENDENCY" })] });
  });

  test("registers a neutral production reference package with exact provenance", () => {
    expect(clinicalModuleRegistry.require(TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION)).toEqual(traumaCoreClinicalModule);
    const published = exercisePackageRegistry.require(TRAUMA_CORE_EXERCISE_PACKAGE.packageId, TRAUMA_CORE_EXERCISE_PACKAGE.packageVersion);
    expect(published.requiredClinicalModules).toEqual([dependency(TRAUMA_CORE_MODULE_ID)]);
    expect(published.definition.clinicalModuleComposition?.modules).toEqual([expect.objectContaining({ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION, moduleHash: traumaCoreClinicalModule.moduleHash })]);
    expect(published.definition.description).toContain("no pelvic or pleural injury physiology");
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
  });

  test("introduces no Runtime branch or upward protocol, assessment, analytics or evaluation dependency", () => {
    const root = process.cwd();
    const traumaSources = fs.readdirSync(path.join(root, "src/modules/traumaCore")).filter(file => file.endsWith(".ts")).map(file => fs.readFileSync(path.join(root, "src/modules/traumaCore", file), "utf8")).join("\n");
    expect(traumaSources).not.toMatch(/services\/(runtime|protocol|assessment|analytics|evaluation|authorization)/);
    expect(fs.readFileSync(path.join(root, "src/services/ScenarioEngine.ts"), "utf8")).not.toContain("TRAUMA_CORE");
    expect(fs.readFileSync(path.join(root, "src/services/runtime/lifecycle/ProductionPatientProcessLifecycle.ts"), "utf8")).not.toContain("TRAUMA_CORE");
  });

  test("preserves deterministic multi-process execution and patient isolation", () => {
    const fixture = (patientId: string, spo2: number): GoldenFixture => ({ fixtureId: `FX-${patientId}`, fixtureType: "PROCESS", patientId, seed: 42, clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"], initialState: { hv: { templateId: "HV-N", ventilationReserve: 70, co2Burden: 40 }, hypoxia: { templateId: "HYP-N", oxygenationReserve: 70, spo2 } } });
    const tick: GoldenInputEvent = { sequenceId: "WP42", step: 1, offsetSec: 60, eventType: "ENGINE_TICK", actor: "ENGINE", target: "PATIENT", eventId: "TICK-1", result: "SUCCESS", payload: { elapsedMin: 1 } };
    const replay = (patientId: string, spo2: number) => { const engine = new ClinicalScenarioEngine(); engine.reset(fixture(patientId, spo2)); engine.advanceTo(60); engine.dispatch(tick); return { state: engine.getRuntimeState(), processes: engine.getPatientProcesses(), events: engine.getEventLog(), hashes: engine.getHashes() }; };
    expect(replay("PT-A", 90)).toEqual(replay("PT-A", 90));
    const patientA = replay("PT-A", 90); const patientB = replay("PT-B", 80);
    expect(patientA.state.encounterId).toBe("PT-A"); expect(patientB.state.encounterId).toBe("PT-B");
    expect(patientA.processes).toHaveLength(2); expect(patientB.processes).toHaveLength(2);
    expect(patientA.state.targetVitals.spo2).not.toBe(patientB.state.targetVitals.spo2);
    expect(patientA.events.every(event => event.target !== "PT-B")).toBe(true);
  });
});
