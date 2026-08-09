import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { AIRWAY_EXERCISE_PACKAGE, CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE, MEDICATION_CORE_EXERCISE_PACKAGE, RESPIRATORY_FAILURE_EXERCISE_PACKAGE } from "./CanonicalExercisePackages";
import { EXERCISE_DEFINITION_CATALOG } from "./ExerciseDefinitionService";
import { ExercisePackageLoader } from "./ExercisePackageLoader";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";

export const exercisePackageValidator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
export const exercisePackageRegistry = new ExercisePackageRegistry(exercisePackageValidator);
export const clinicalModuleRegistry = new ClinicalModuleRegistry();
clinicalModuleRegistry.register(airwayClinicalModule);
clinicalModuleRegistry.register(respiratoryFailureClinicalModule);
clinicalModuleRegistry.register(medicationCoreClinicalModule);
export const clinicalModuleComposer = new ClinicalModuleComposer(clinicalModuleRegistry);
export const exercisePackageLoader = new ExercisePackageLoader(exercisePackageValidator, exercisePackageRegistry, clinicalModuleComposer);
CANONICAL_EXERCISE_PACKAGES.forEach(pkg => exercisePackageLoader.load(pkg));
exercisePackageLoader.load(AIRWAY_EXERCISE_PACKAGE);
exercisePackageLoader.load(RESPIRATORY_FAILURE_EXERCISE_PACKAGE);
exercisePackageLoader.load(MEDICATION_CORE_EXERCISE_PACKAGE);
exercisePackageLoader.bind("demo", DEFAULT_EXERCISE_PACKAGE);
export function getExercisePackage(exerciseId: string): ExercisePackage { return exercisePackageLoader.getBound(exerciseId) ?? DEFAULT_EXERCISE_PACKAGE; }
export function getExerciseDefinition(exerciseId: string): ExercisePackage["definition"] { return getExercisePackage(exerciseId).definition; }
export function isPatientProcessEnabled(exerciseId: string, processType: string): boolean { return getExerciseDefinition(exerciseId).enabledPatientProcesses.includes(processType); }
