import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { DEFAULT_EXERCISE_DEFINITION } from "@/services/exercise/ExerciseDefinitionService";
import { cardiacArrestClinicalModule } from "../CardiacArrestClinicalModule";
import { CARDIAC_ARREST_MODULE_ID, CARDIAC_ARREST_MODULE_VERSION, cardiacArrestManifest } from "../CardiacArrestManifest";
import { CARDIAC_ARREST_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { clinicalModuleRegistry, exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";

describe("WP-36 CARDIAC_ARREST_V1 Clinical Module", () => {
  test("is immutable, deterministic and has no unnecessary dependencies", () => {
    expect(cardiacArrestManifest).toEqual({ moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION,
      description: expect.any(String), dependencies: [], compatibilityVersion: 1 });
    expect(Object.isFrozen(cardiacArrestClinicalModule)).toBe(true);
    expect(cardiacArrestClinicalModule.moduleHash).toHaveLength(64);
  });

  test("owns only its process, effects, interventions and validation contract", () => {
    expect(cardiacArrestClinicalModule.registrations).toMatchObject({
      patientProcesses: ["CARDIAC_ARREST"],
      clinicalEffects: ["CPR_STARTED", "CPR_STOPPED", "DEFIBRILLATION_ATTEMPT"],
      interventions: ["DEFIBRILLATION", "START_CPR", "STOP_CPR"],
      medications: [], analyticsProviders: [], metricProviders: [], assessmentRules: [],
      validationRules: ["CARDIAC_ARREST_CONFIGURATION_V1"],
    });
  });

  test("composition is registration-order independent", () => {
    const compose = () => { const registry = new ClinicalModuleRegistry(); registry.register(cardiacArrestClinicalModule);
      return new ClinicalModuleComposer(registry).compose(DEFAULT_EXERCISE_DEFINITION,
        [{ moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION }]); };
    expect(compose()).toEqual(compose());
    expect(compose()).toMatchObject({ ok: true, definition: { enabledPatientProcesses: expect.arrayContaining(["CARDIAC_ARREST"]) } });
  });

  test("is production-registered with a supported catalog reference package and provenance", () => {
    expect(clinicalModuleRegistry.require(CARDIAC_ARREST_MODULE_ID, CARDIAC_ARREST_MODULE_VERSION)).toEqual(cardiacArrestClinicalModule);
    const pkg = exercisePackageRegistry.require(CARDIAC_ARREST_EXERCISE_PACKAGE.packageId, CARDIAC_ARREST_EXERCISE_PACKAGE.packageVersion);
    expect(exercisePackageValidator.compatibility(pkg)).toBe("SUPPORTED");
    expect(pkg.definition.clinicalModuleComposition?.modules).toEqual([
      expect.objectContaining({ moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION, compositionOrder: 0 }),
    ]);
    expect({ moduleHash: cardiacArrestClinicalModule.moduleHash, definitionHash: pkg.manifest.definitionHash,
      packageHash: pkg.packageHash }).toEqual({
      moduleHash: "c10a43f8872e8fefbf17199deee0912f0be815638af94aa3ca20ac922e91f640",
      definitionHash: "737cb8aea68a300a80a4434c8711de85ebde9eb95a230c266854910599d860f3",
      packageHash: "e5b1c0316a203ac9156f0e190676e794cd5c36d5cc1ee5f1095c2340ecbbffb2",
    });
  });
});
