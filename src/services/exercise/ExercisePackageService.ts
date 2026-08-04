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
const bindings = new Map<string, string>([["demo", `${DEFAULT_EXERCISE_PACKAGE.packageId}@${DEFAULT_EXERCISE_PACKAGE.packageVersion}`]]);
export function bindExercisePackage(exerciseId: string, pkg: ExercisePackage): ExercisePackage { const loaded = exercisePackageLoader.load(pkg, exerciseId); bindings.set(exerciseId, `${loaded.packageId}@${loaded.packageVersion}`); return loaded; }
export function getExercisePackage(exerciseId: string): ExercisePackage { const reference = bindings.get(exerciseId) ?? `${DEFAULT_EXERCISE_PACKAGE.packageId}@${DEFAULT_EXERCISE_PACKAGE.packageVersion}`; const split = reference.lastIndexOf("@"); return exercisePackageRegistry.require(reference.slice(0, split), reference.slice(split + 1)); }
