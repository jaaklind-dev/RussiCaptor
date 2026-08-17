import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION } from "@/modules/airway/AirwayManifest";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { getAnalyticsReport } from "@/services/AnalyticsService";
import {
  CANONICAL_EXERCISE_PACKAGES,
  DEFAULT_EXERCISE_PACKAGE,
  RESPIRATORY_FAILURE_EXERCISE_PACKAGE,
} from "@/services/exercise/CanonicalExercisePackages";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import {
  applyRespiratoryFailureClinicalEffect,
  bootstrapRespiratoryFailurePatientProcess,
  tickRespiratoryFailurePatientProcess,
} from "@/services/runtime/RespiratoryFailurePatientProcess";
import { respiratoryFailureClinicalModule } from "../RespiratoryFailureClinicalModule";
import {
  RESPIRATORY_FAILURE_MODULE_ID,
  RESPIRATORY_FAILURE_MODULE_VERSION,
  respiratoryFailureManifest,
} from "../RespiratoryFailureManifest";
import {
  RESPIRATORY_FAILURE_CONSUMED_CLINICAL_EFFECT_IDS,
  RESPIRATORY_FAILURE_PHENOTYPES,
  RESPIRATORY_FAILURE_PROCESS_ID,
} from "../RespiratoryFailureRegistrations";

const emptyRegistrations = () => ({
  patientProcesses: [], clinicalEffects: [], interventions: [], medications: [], assessmentRules: [],
  analyticsProviders: [], metricProviders: [], capabilities: [], objectives: [], validationRules: [],
});

const compose = (modules = [airwayClinicalModule, respiratoryFailureClinicalModule]) => {
  const registry = new ClinicalModuleRegistry();
  modules.forEach(module => registry.register(module));
  return new ClinicalModuleComposer(registry).compose(
    RESPIRATORY_FAILURE_EXERCISE_PACKAGE.definition,
    RESPIRATORY_FAILURE_EXERCISE_PACKAGE.requiredClinicalModules!,
  );
};

describe("WP-33 RESPIRATORY_FAILURE_V1 Clinical Module", () => {
  test("publishes an immutable exact-version manifest with an explicit Airway dependency", () => {
    expect(respiratoryFailureManifest).toEqual(expect.objectContaining({
      moduleId: RESPIRATORY_FAILURE_MODULE_ID,
      version: RESPIRATORY_FAILURE_MODULE_VERSION,
      dependencies: [{ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }],
      compatibilityVersion: 1,
    }));
    expect(Object.isFrozen(respiratoryFailureClinicalModule)).toBe(true);
    expect(Object.isFrozen(respiratoryFailureClinicalModule.manifest.dependencies)).toBe(true);
    expect(respiratoryFailureClinicalModule.moduleHash).toHaveLength(64);
  });

  test("registers the existing process, unique effect and configured phenotypes without duplicates", () => {
    expect(respiratoryFailureClinicalModule.registrations.patientProcesses).toEqual([RESPIRATORY_FAILURE_PROCESS_ID]);
    expect(respiratoryFailureClinicalModule.registrations.clinicalEffects).toEqual(["INSPIRED_OXYGEN_REMOVED"]);
    expect(RESPIRATORY_FAILURE_CONSUMED_CLINICAL_EFFECT_IDS).toEqual([
      "AIRWAY_PROTECTED", "EFFECTIVE_VENTILATION", "INSPIRED_OXYGEN_INCREASED",
      "INSPIRED_OXYGEN_REMOVED", "UPPER_AIRWAY_PATENCY",
    ]);
    expect(RESPIRATORY_FAILURE_PHENOTYPES).toEqual(["HYPERCAPNIC", "HYPOXAEMIC", "MIXED"]);
    expect(respiratoryFailureClinicalModule.registrations.interventions).toEqual([]);
    expect(respiratoryFailureClinicalModule.registrations.analyticsProviders).toEqual([]);
  });

  test("resolves Airway transitively before Respiratory Failure independent of registration order", () => {
    const first = compose([airwayClinicalModule, respiratoryFailureClinicalModule]);
    const second = compose([respiratoryFailureClinicalModule, airwayClinicalModule]);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.composition.modules.map(module => `${module.moduleId}@${module.version}:${module.compositionOrder}`)).toEqual([
      `${AIRWAY_MODULE_ID}@${AIRWAY_MODULE_VERSION}:0`,
      `${RESPIRATORY_FAILURE_MODULE_ID}@${RESPIRATORY_FAILURE_MODULE_VERSION}:1`,
    ]);
  });

  test("fails closed with typed diagnostics when Airway is missing or only the wrong version exists", () => {
    const missing = compose([respiratoryFailureClinicalModule]);
    expect(missing).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "MISSING_DEPENDENCY", moduleId: AIRWAY_MODULE_ID })] });
    const airwayV2 = createClinicalModule({
      moduleId: AIRWAY_MODULE_ID, version: "2.0.0",
      manifest: { description: "Incompatible test Airway", dependencies: [], compatibilityVersion: 1 },
      registrations: emptyRegistrations(),
    });
    const wrong = compose([respiratoryFailureClinicalModule, airwayV2]);
    expect(wrong).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "VERSION_MISMATCH", moduleId: AIRWAY_MODULE_ID })] });
  });

  test("rejects duplicate Respiratory Failure PatientProcess ownership", () => {
    const conflict = new ClinicalModuleComposer(clinicalModuleRegistry).compose(
      DEFAULT_EXERCISE_PACKAGE.definition,
      [{ moduleId: RESPIRATORY_FAILURE_MODULE_ID, version: RESPIRATORY_FAILURE_MODULE_VERSION }],
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.diagnostics).toContainEqual(expect.objectContaining({ code: "DUPLICATE_PATIENT_PROCESS" }));
  });

  test("publishes a deterministic reference Package and composed Definition", () => {
    const published = exercisePackageRegistry.require(
      RESPIRATORY_FAILURE_EXERCISE_PACKAGE.packageId,
      RESPIRATORY_FAILURE_EXERCISE_PACKAGE.packageVersion,
    );
    expect(published.requiredClinicalModules).toEqual([{
      moduleId: RESPIRATORY_FAILURE_MODULE_ID,
      version: RESPIRATORY_FAILURE_MODULE_VERSION,
    }]);
    expect(published.definition.clinicalModuleComposition?.modules.map(module => module.moduleId)).toEqual([
      AIRWAY_MODULE_ID,
      RESPIRATORY_FAILURE_MODULE_ID,
    ]);
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
    const first = compose(); const second = compose();
    expect(first.ok && hashExerciseDefinition(first.definition)).toBe(second.ok && hashExerciseDefinition(second.definition));
  });

  test("keeps Runtime-facing selections and all module-free Package hashes unchanged", () => {
    const published = exercisePackageRegistry.require(
      RESPIRATORY_FAILURE_EXERCISE_PACKAGE.packageId,
      RESPIRATORY_FAILURE_EXERCISE_PACKAGE.packageVersion,
    );
    expect(published.definition.enabledPatientProcesses).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledPatientProcesses);
    expect(published.definition.enabledAnalyticsProviders).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledAnalyticsProviders);
    expect(published.definition.enabledMetricProviders).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledMetricProviders);
    expect(CANONICAL_EXERCISE_PACKAGES.every(pkg => !pkg.requiredClinicalModules)).toBe(true);
    expect(DEFAULT_EXERCISE_PACKAGE).toMatchObject({
      packageHash: "a32f63f6730596a8491279213bd4ac0c7806efe96b157992beeb3183edb266ae",
      manifest: { definitionHash: "b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b" },
    });
  });

  test.each(RESPIRATORY_FAILURE_PHENOTYPES)("preserves deterministic %s process behaviour", phenotype => {
    const run = () => {
      let process = bootstrapRespiratoryFailurePatientProcess(
        { fixtureId: `FX-${phenotype}`, patientId: `PT-${phenotype}` },
        { processId: `RF-${phenotype}`, phenotype, spo2: 90, respiratoryRate: 24, etco2: 48, gcs: 15, workOfBreathing: 30, fatigue: 20 },
      );
      process = tickRespiratoryFailurePatientProcess(process, 60);
      process = applyRespiratoryFailureClinicalEffect(process, { effectType: "INSPIRED_OXYGEN_INCREASED" });
      process = applyRespiratoryFailureClinicalEffect(process, { effectType: "EFFECTIVE_VENTILATION", mode: "BVM" });
      process = tickRespiratoryFailurePatientProcess(process, 60);
      process = applyRespiratoryFailureClinicalEffect(process, { effectType: "EFFECTIVE_VENTILATION", mode: "MECHANICAL" });
      return tickRespiratoryFailurePatientProcess(process, 60);
    };
    expect(run()).toEqual(run());
  });

  test("leaves Analytics unchanged and composes within the existing configuration budget", () => {
    const analytics = getAnalyticsReport(); const started = Date.now();
    for (let index = 0; index < 100; index += 1) expect(compose().ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(getAnalyticsReport()).toEqual(analytics);
  });
});
