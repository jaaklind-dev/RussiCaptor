import { airwayClinicalModule } from "../AirwayClinicalModule";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION, airwayManifest } from "../AirwayManifest";
import { AIRWAY_CLINICAL_EFFECT_IDS, AIRWAY_INTERVENTION_IDS } from "../AirwayRegistrations";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { AIRWAY_EXERCISE_PACKAGE, CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { getAnalyticsReport } from "@/services/AnalyticsService";

describe("WP-32 AIRWAY_V1 Clinical Module", () => {
  test("publishes an immutable, exact-version manifest with no dependencies", () => {
    expect(airwayManifest).toEqual(expect.objectContaining({
      moduleId: AIRWAY_MODULE_ID,
      version: AIRWAY_MODULE_VERSION,
      compatibilityVersion: 1,
      dependencies: [],
    }));
    expect(Object.isFrozen(airwayClinicalModule)).toBe(true);
    expect(Object.isFrozen(airwayClinicalModule.registrations)).toBe(true);
    expect(airwayClinicalModule.moduleHash).toHaveLength(64);
  });

  test("registers only existing airway intervention definitions and effects", () => {
    expect(AIRWAY_INTERVENTION_IDS).toEqual(
      airwayInterventionDefinitions.map(definition => definition.definitionId).sort(),
    );
    expect(AIRWAY_CLINICAL_EFFECT_IDS).toEqual(
      [...new Set(airwayInterventionDefinitions.flatMap(definition => definition.effects.map(effect => effect.effectType)))].sort(),
    );
    expect(airwayClinicalModule.registrations).toMatchObject({
      patientProcesses: [],
      analyticsProviders: ["core.interventions"],
      metricProviders: ["core.interventions"],
    });
  });

  test("registers and resolves deterministically through the production registry", () => {
    expect(clinicalModuleRegistry.require(AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION)).toEqual(airwayClinicalModule);
    const first = new ClinicalModuleRegistry();
    const second = new ClinicalModuleRegistry();
    first.register(airwayClinicalModule);
    second.register(airwayClinicalModule);
    expect(first.modules).toEqual(second.modules);
  });

  test("composes the module without changing the Runtime-facing selections", () => {
    const registry = new ClinicalModuleRegistry();
    registry.register(airwayClinicalModule);
    const result = new ClinicalModuleComposer(registry).compose(AIRWAY_EXERCISE_PACKAGE.definition, AIRWAY_EXERCISE_PACKAGE.requiredClinicalModules!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.enabledPatientProcesses).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledPatientProcesses);
    expect(result.definition.enabledAnalyticsProviders).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledAnalyticsProviders);
    expect(result.definition.enabledMetricProviders).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledMetricProviders);
    expect(result.composition.modules).toEqual([expect.objectContaining({
      moduleId: AIRWAY_MODULE_ID,
      version: AIRWAY_MODULE_VERSION,
      moduleHash: airwayClinicalModule.moduleHash,
      compositionOrder: 0,
    })]);
  });

  test("loads one composed reference Package with canonical provenance", () => {
    const published = exercisePackageRegistry.require(AIRWAY_EXERCISE_PACKAGE.packageId, AIRWAY_EXERCISE_PACKAGE.packageVersion);
    expect(published.requiredClinicalModules).toEqual([{ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }]);
    expect(published.definition.clinicalModuleComposition?.modules).toEqual([
      expect.objectContaining({ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }),
    ]);
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
  });

  test("keeps every module-free Package hash and Definition hash unchanged", () => {
    const identities = CANONICAL_EXERCISE_PACKAGES.map(pkg => ({
      packageId: pkg.packageId,
      packageHash: pkg.packageHash,
      definitionHash: pkg.manifest.definitionHash,
    }));
    expect(CANONICAL_EXERCISE_PACKAGES.every(pkg => !pkg.requiredClinicalModules && !pkg.definition.clinicalModuleComposition)).toBe(true);
    expect(identities.find(item => item.packageId === DEFAULT_EXERCISE_PACKAGE.packageId)).toEqual({
      packageId: DEFAULT_EXERCISE_PACKAGE.packageId,
      packageHash: "c6ff142e1cfbdcb37757f159fbbd95128f9ee4a961972d22264c44317b6e803d",
      definitionHash: "b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b",
    });
  });

  test("does not alter the canonical Analytics report", () => {
    const before = getAnalyticsReport();
    exercisePackageRegistry.require(AIRWAY_EXERCISE_PACKAGE.packageId, AIRWAY_EXERCISE_PACKAGE.packageVersion);
    expect(getAnalyticsReport()).toEqual(before);
  });
});
