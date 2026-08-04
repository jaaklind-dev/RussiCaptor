import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "./CanonicalExercisePackages";
import { EXERCISE_DEFINITION_CATALOG } from "./ExerciseDefinitionService";
import { ExercisePackageLoader } from "./ExercisePackageLoader";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";

export const exercisePackageValidator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
export const exercisePackageRegistry = new ExercisePackageRegistry(exercisePackageValidator);
export const exercisePackageLoader = new ExercisePackageLoader(exercisePackageValidator, exercisePackageRegistry);
CANONICAL_EXERCISE_PACKAGES.forEach(pkg => exercisePackageLoader.load(pkg));
exercisePackageLoader.bind("demo", DEFAULT_EXERCISE_PACKAGE);
export function getExercisePackage(exerciseId: string): ExercisePackage { return exercisePackageLoader.getBound(exerciseId) ?? DEFAULT_EXERCISE_PACKAGE; }
export function getExerciseDefinition(exerciseId: string): ExercisePackage["definition"] { return getExercisePackage(exerciseId).definition; }
export function isPatientProcessEnabled(exerciseId: string, processType: string): boolean { return getExerciseDefinition(exerciseId).enabledPatientProcesses.includes(processType); }
