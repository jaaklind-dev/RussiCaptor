import type { CirculationState } from "@/models/CirculationState";
import type { MedicationAdministration, MedicationDefinition } from "@/models/MedicationRuntime";
import { createClinicalModule } from "@/services/clinical/ClinicalModuleHash";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { getAnalyticsReport } from "@/services/AnalyticsService";
import {
  CANONICAL_EXERCISE_PACKAGES,
  DEFAULT_EXERCISE_PACKAGE,
  MEDICATION_CORE_EXERCISE_PACKAGE,
} from "@/services/exercise/CanonicalExercisePackages";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { clinicalModuleRegistry, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { medicationAssessmentRules } from "@/services/runtime/assessment/MedicationAssessmentRules";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { medicationCoreClinicalModule } from "../MedicationCoreClinicalModule";
import {
  MEDICATION_CORE_MODULE_ID,
  MEDICATION_CORE_MODULE_VERSION,
  medicationCoreManifest,
} from "../MedicationCoreManifest";
import {
  MEDICATION_CORE_ASSESSMENT_RULE_IDS,
  MEDICATION_CORE_PROCESS_ID,
} from "../MedicationCoreRegistrations";

const emptyRegistrations = () => ({
  patientProcesses: [], clinicalEffects: [], interventions: [], medications: [], assessmentRules: [],
  analyticsProviders: [], metricProviders: [], capabilities: [], objectives: [], validationRules: [],
});

const compose = () => {
  const registry = new ClinicalModuleRegistry(); registry.register(medicationCoreClinicalModule);
  return new ClinicalModuleComposer(registry).compose(
    MEDICATION_CORE_EXERCISE_PACKAGE.definition,
    MEDICATION_CORE_EXERCISE_PACKAGE.requiredClinicalModules!,
  );
};

const definition: MedicationDefinition = {
  medicationId: "MED-CONFIGURED", name: "Configured medication", routes: ["IV", "IO", "IM", "PO"],
  category: "other", durationSec: 60,
  supportedEffects: [{ effectType: "SUPPORT_CIRCULATION", parameters: { strength: 1 } }], metadata: {},
};
const circulation: CirculationState = {
  patientId: "PT-MED", vascularAccess: [{ interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["IV"], establishedAt: 0 }],
  hemorrhageControl: [], runningInfusions: [], updatedAt: 0,
};
const administration: MedicationAdministration = {
  administrationId: "ADMIN-1", medicationId: definition.medicationId, patientId: circulation.patientId,
  route: "IV", dose: 1, unit: "configured-unit", timestamp: 10, administrator: "CM-1", vascularAccessId: "IV-1",
};

describe("WP-34 MEDICATION_CORE_V1 Clinical Module", () => {
  test("publishes an immutable exact-version dependency-free manifest", () => {
    expect(medicationCoreManifest).toEqual(expect.objectContaining({
      moduleId: MEDICATION_CORE_MODULE_ID,
      version: MEDICATION_CORE_MODULE_VERSION,
      compatibilityVersion: 1,
      dependencies: [],
    }));
    expect(Object.isFrozen(medicationCoreClinicalModule)).toBe(true);
    expect(Object.isFrozen(medicationCoreClinicalModule.registrations)).toBe(true);
    expect(medicationCoreClinicalModule.moduleHash).toHaveLength(64);
  });

  test("registers the existing framework capability and production assessment hooks only", () => {
    expect(medicationCoreClinicalModule.registrations.patientProcesses).toEqual([MEDICATION_CORE_PROCESS_ID]);
    expect(MEDICATION_CORE_ASSESSMENT_RULE_IDS).toEqual(medicationAssessmentRules.map(rule => rule.ruleId).sort());
    expect(medicationCoreClinicalModule.registrations.assessmentRules).toEqual(MEDICATION_CORE_ASSESSMENT_RULE_IDS);
    expect(medicationCoreClinicalModule.registrations.medications).toEqual([]);
    expect(medicationCoreClinicalModule.registrations.clinicalEffects).toEqual([]);
    expect(medicationCoreClinicalModule.registrations.analyticsProviders).toEqual([]);
  });

  test("is registered in production and resolves deterministically as order zero", () => {
    expect(clinicalModuleRegistry.require(MEDICATION_CORE_MODULE_ID, MEDICATION_CORE_MODULE_VERSION)).toEqual(medicationCoreClinicalModule);
    const first = compose(); const second = compose();
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    if (first.ok) expect(first.composition.modules).toEqual([
      expect.objectContaining({ moduleId: MEDICATION_CORE_MODULE_ID, version: MEDICATION_CORE_MODULE_VERSION, compositionOrder: 0 }),
    ]);
  });

  test("publishes a deterministic reference Package with unchanged Runtime-facing selections", () => {
    const published = exercisePackageRegistry.require(
      MEDICATION_CORE_EXERCISE_PACKAGE.packageId,
      MEDICATION_CORE_EXERCISE_PACKAGE.packageVersion,
    );
    expect(published.requiredClinicalModules).toEqual([{
      moduleId: MEDICATION_CORE_MODULE_ID,
      version: MEDICATION_CORE_MODULE_VERSION,
    }]);
    expect(published.definition.clinicalModuleComposition?.modules).toEqual([
      expect.objectContaining({ moduleId: MEDICATION_CORE_MODULE_ID, compositionOrder: 0 }),
    ]);
    expect(published.definition.enabledPatientProcesses).toEqual(DEFAULT_EXERCISE_PACKAGE.definition.enabledPatientProcesses);
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
  });

  test("fails closed for wrong versions and duplicate process ownership", () => {
    const wrong = new ClinicalModuleComposer(clinicalModuleRegistry).compose(
      MEDICATION_CORE_EXERCISE_PACKAGE.definition,
      [{ moduleId: MEDICATION_CORE_MODULE_ID, version: "2.0.0" }],
    );
    expect(wrong).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "VERSION_MISMATCH" })] });
    const duplicate = new ClinicalModuleComposer(clinicalModuleRegistry).compose(
      DEFAULT_EXERCISE_PACKAGE.definition,
      [{ moduleId: MEDICATION_CORE_MODULE_ID, version: MEDICATION_CORE_MODULE_VERSION }],
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({ code: "DUPLICATE_PATIENT_PROCESS" }));
  });

  test.each([
    ["medications", "DUPLICATE_MEDICATION"],
    ["clinicalEffects", "DUPLICATE_CLINICAL_EFFECT"],
    ["analyticsProviders", "DUPLICATE_ANALYTICS_PROVIDER"],
  ] as const)("rejects duplicate %s registrations", (group, code) => {
    const registration = { ...emptyRegistrations(), [group]: ["DUPLICATE"] };
    const first = createClinicalModule({ moduleId: "DUPLICATE_A", version: "1.0.0", manifest: { description: "First", dependencies: [], compatibilityVersion: 1 }, registrations: registration });
    const second = createClinicalModule({ moduleId: "DUPLICATE_B", version: "1.0.0", manifest: { description: "Second", dependencies: [], compatibilityVersion: 1 }, registrations: registration });
    const registry = new ClinicalModuleRegistry(); registry.register(first); registry.register(second);
    const result = new ClinicalModuleComposer(registry).compose(MEDICATION_CORE_EXERCISE_PACKAGE.definition, [
      { moduleId: first.moduleId, version: first.version }, { moduleId: second.moduleId, version: second.version },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
  });

  test("preserves the configured medication lifecycle, effects, events and replay hash", () => {
    const replay = () => {
      const composition = compose(); if (!composition.ok) throw new Error("Medication Core composition failed");
      const engine = new MedicationEngine(); engine.installDefinitions([definition]);
      const administered = engine.administer(administration, circulation);
      engine.cancel(administration.administrationId, 20);
      const snapshot = engine.snapshot();
      return { administered, snapshot, replayHash: sha256Text(stableJson({ administered, snapshot })) };
    };
    const first = replay(); const second = replay();
    expect(first.administered).toMatchObject({
      instance: { status: "ACTIVE" },
      effects: [{ effectType: "SUPPORT_CIRCULATION" }],
      events: [{ eventType: "MedicationOrdered" }, { eventType: "MedicationStarted" }],
    });
    expect(first.snapshot.instances).toEqual([expect.objectContaining({ status: "CANCELLED" })]);
    expect(second).toEqual(first); expect(second.replayHash).toBe(first.replayHash);
  });

  test("keeps historical hashes and Analytics unchanged within the composition budget", () => {
    const analytics = getAnalyticsReport(); const started = Date.now();
    for (let index = 0; index < 100; index += 1) expect(compose().ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(getAnalyticsReport()).toEqual(analytics);
    expect(CANONICAL_EXERCISE_PACKAGES.every(pkg => !pkg.requiredClinicalModules)).toBe(true);
    expect(DEFAULT_EXERCISE_PACKAGE).toMatchObject({
      packageHash: "c6ff142e1cfbdcb37757f159fbbd95128f9ee4a961972d22264c44317b6e803d",
      manifest: { definitionHash: "b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b" },
    });
  });
});
