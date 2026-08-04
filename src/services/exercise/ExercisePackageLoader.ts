import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";
import { bindExerciseDefinition, exerciseDefinitionRegistry } from "./ExerciseDefinitionService";

export class ExercisePackageLoader {
  constructor(private readonly validator: ExercisePackageValidator, private readonly registry: ExercisePackageRegistry) {}
  load(pkg: ExercisePackage, exerciseId?: string): ExercisePackage {
    this.validator.assertValid(pkg);
    const existing = exerciseDefinitionRegistry.get(pkg.definition.exerciseTypeId, pkg.definition.definitionVersion);
    if (existing && hashExerciseDefinition(existing) !== pkg.manifest.definitionHash) throw new Error("EXERCISE_DEFINITION_VERSION_CONFLICT");
    if (!existing) exerciseDefinitionRegistry.register(pkg.definition);
    if (!this.registry.get(pkg.packageId, pkg.packageVersion)) this.registry.register(pkg);
    const published = this.registry.require(pkg.packageId, pkg.packageVersion);
    if (exerciseId) bindExerciseDefinition(exerciseId, published.definition);
    return published;
  }
}
