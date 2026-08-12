import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { AIRWAY_EXERCISE_PACKAGE, ALS_EXERCISE_PACKAGE, ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE, CANONICAL_EXERCISE_PACKAGES, CARDIAC_ARREST_EXERCISE_PACKAGE, DEFAULT_EXERCISE_PACKAGE, MEDICATION_CORE_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE, RESPIRATORY_FAILURE_EXERCISE_PACKAGE, TRAUMA_CORE_EXERCISE_PACKAGE } from "./CanonicalExercisePackages";
import { EXERCISE_DEFINITION_CATALOG } from "./ExerciseDefinitionService";
import { ExercisePackageLoader } from "./ExercisePackageLoader";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";
import { ClinicalModuleRegistry } from "@/services/clinical/ClinicalModuleRegistry";
import { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { airwayClinicalModule } from "@/modules/airway/AirwayClinicalModule";
import { respiratoryFailureClinicalModule } from "@/modules/respiratoryFailure/RespiratoryFailureClinicalModule";
import { medicationCoreClinicalModule } from "@/modules/medicationCore/MedicationCoreClinicalModule";
import { alsClinicalModule } from "@/modules/als/AlsClinicalModule";
import { cardiacArrestClinicalModule } from "@/modules/cardiacArrest/CardiacArrestClinicalModule";
import { traumaCoreClinicalModule } from "@/modules/traumaCore/TraumaCoreClinicalModule";
import { pelvicInjuryClinicalModule } from "@/modules/pelvicInjury/PelvicInjuryClinicalModule";
import { protocolConfigurationRegistry } from "@/services/protocol/ProtocolConfigurationService";
import { ProtocolCompositionService } from "@/services/protocol/ProtocolCompositionService";
import { ExerciseEvaluationCompositionService } from "@/services/evaluation/ExerciseEvaluationCompositionService";
import { exerciseEvaluationProfileRegistry } from "@/services/evaluation/ExerciseEvaluationProfileService";

export const exercisePackageValidator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
export const exercisePackageRegistry = new ExercisePackageRegistry(exercisePackageValidator);
export const clinicalModuleRegistry = new ClinicalModuleRegistry();
clinicalModuleRegistry.register(airwayClinicalModule);
clinicalModuleRegistry.register(respiratoryFailureClinicalModule);
clinicalModuleRegistry.register(medicationCoreClinicalModule);
clinicalModuleRegistry.register(cardiacArrestClinicalModule);
clinicalModuleRegistry.register(alsClinicalModule);
clinicalModuleRegistry.register(traumaCoreClinicalModule);
clinicalModuleRegistry.register(pelvicInjuryClinicalModule);
export const clinicalModuleComposer = new ClinicalModuleComposer(clinicalModuleRegistry);
export const exercisePackageLoader = new ExercisePackageLoader(exercisePackageValidator, exercisePackageRegistry, clinicalModuleComposer, new ProtocolCompositionService(protocolConfigurationRegistry), new ExerciseEvaluationCompositionService(exerciseEvaluationProfileRegistry, protocolConfigurationRegistry));
CANONICAL_EXERCISE_PACKAGES.forEach(pkg => exercisePackageLoader.load(pkg));
exercisePackageLoader.load(AIRWAY_EXERCISE_PACKAGE);
exercisePackageLoader.load(RESPIRATORY_FAILURE_EXERCISE_PACKAGE);
exercisePackageLoader.load(MEDICATION_CORE_EXERCISE_PACKAGE);
exercisePackageLoader.load(CARDIAC_ARREST_EXERCISE_PACKAGE);
exercisePackageLoader.load(ALS_EXERCISE_PACKAGE);
exercisePackageLoader.load(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE);
exercisePackageLoader.load(TRAUMA_CORE_EXERCISE_PACKAGE);
exercisePackageLoader.load(PELVIC_INJURY_EXERCISE_PACKAGE);
exercisePackageLoader.bind("demo", DEFAULT_EXERCISE_PACKAGE);
export function getExercisePackage(exerciseId: string): ExercisePackage { return exercisePackageLoader.getBound(exerciseId) ?? DEFAULT_EXERCISE_PACKAGE; }
export function getExerciseDefinition(exerciseId: string): ExercisePackage["definition"] { return getExercisePackage(exerciseId).definition; }
export function isPatientProcessEnabled(exerciseId: string, processType: string): boolean { return getExerciseDefinition(exerciseId).enabledPatientProcesses.includes(processType); }
