import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";
import { exerciseDefinitionRegistry } from "./ExerciseDefinitionService";

export class ExercisePackageLoader {
  private readonly bindings = new Map<string, string>();
  constructor(private readonly validator: ExercisePackageValidator, private readonly registry: ExercisePackageRegistry) {}
  load(pkg: ExercisePackage): ExercisePackage {
    this.validator.assertValid(pkg);
    const existing = exerciseDefinitionRegistry.get(pkg.definition.exerciseTypeId, pkg.definition.definitionVersion);
    if (existing && hashExerciseDefinition(existing) !== pkg.manifest.definitionHash) throw new Error("EXERCISE_DEFINITION_VERSION_CONFLICT");
    if (!existing) exerciseDefinitionRegistry.register(pkg.definition);
    if (!this.registry.get(pkg.packageId, pkg.packageVersion)) this.registry.register(pkg);
    const published = this.registry.require(pkg.packageId, pkg.packageVersion);
    return published;
  }
  bind(exerciseId: string, pkg: ExercisePackage): ExercisePackage {
    const reference = `${pkg.packageId}@${pkg.packageVersion}`;
    const existing = this.bindings.get(exerciseId);
    if (existing && existing !== reference) throw new Error(`EXERCISE_PACKAGE_BINDING_CONFLICT:${exerciseId}`);
    const published = this.load(pkg);
    this.bindings.set(exerciseId, reference); return published;
  }
  getBound(exerciseId: string): ExercisePackage | undefined {
    const reference = this.bindings.get(exerciseId); if (!reference) return undefined;
    const split = reference.lastIndexOf("@"); return this.registry.require(reference.slice(0, split), reference.slice(split + 1));
  }
}
