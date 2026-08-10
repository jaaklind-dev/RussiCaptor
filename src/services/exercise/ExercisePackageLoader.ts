import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";
import { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { ExercisePackageValidator } from "./ExercisePackageValidator";
import { exerciseDefinitionRegistry } from "./ExerciseDefinitionService";
import type { ClinicalModuleComposer } from "@/services/clinical/ClinicalModuleComposer";
import { createExercisePackage } from "./ExercisePackageHash";
import type { ProtocolCompositionService } from "@/services/protocol/ProtocolCompositionService";

export class ExercisePackageLoader {
  private readonly bindings = new Map<string, string>();
  constructor(private readonly validator: ExercisePackageValidator, private readonly registry: ExercisePackageRegistry, private readonly moduleComposer?: ClinicalModuleComposer, private readonly protocolComposer?: ProtocolCompositionService) {}
  private compose(pkg: ExercisePackage): ExercisePackage {
    let definition = pkg.definition;
    if (pkg.requiredClinicalModules?.length) {
      if (!this.moduleComposer) throw new Error("CLINICAL_MODULE_COMPOSER_REQUIRED");
      const result = this.moduleComposer.compose(definition, pkg.requiredClinicalModules);
      if (!result.ok) throw new Error(`CLINICAL_MODULE_COMPOSITION_FAILED:${result.diagnostics.map(item => item.code).join(",")}`);
      definition = result.definition;
    }
    if (pkg.protocolConfiguration) {
      if (!this.protocolComposer) throw new Error("PROTOCOL_COMPOSER_REQUIRED");
      const result = this.protocolComposer.compose(definition, pkg.protocolConfiguration, pkg.packageId);
      if (!result.ok) throw new Error(`PROTOCOL_COMPOSITION_FAILED:${result.diagnostics.map(item => item.code).join(",")}`);
      definition = result.definition;
    }
    if (definition === pkg.definition) return pkg;
    return createExercisePackage({
      packageId: pkg.packageId, packageVersion: pkg.packageVersion, definition,
      patientDatasetId: pkg.patientDatasetId, enabledPatientProcesses: definition.enabledPatientProcesses,
      enabledAnalyticsProviders: definition.enabledAnalyticsProviders, enabledMetricProviders: definition.enabledMetricProviders,
      metadata: pkg.metadata, requiredClinicalModules: pkg.requiredClinicalModules,
      protocolConfiguration: pkg.protocolConfiguration,
      compatibilityVersion: pkg.manifest.compatibilityVersion,
    });
  }
  load(pkg: ExercisePackage): ExercisePackage {
    this.validator.assertValid(pkg);
    const canonicalPackage = this.compose(pkg);
    this.validator.assertValid(canonicalPackage);
    const existing = exerciseDefinitionRegistry.get(canonicalPackage.definition.exerciseTypeId, canonicalPackage.definition.definitionVersion);
    if (existing && hashExerciseDefinition(existing) !== canonicalPackage.manifest.definitionHash) throw new Error("EXERCISE_DEFINITION_VERSION_CONFLICT");
    if (!existing) exerciseDefinitionRegistry.register(canonicalPackage.definition);
    if (!this.registry.get(canonicalPackage.packageId, canonicalPackage.packageVersion)) this.registry.register(canonicalPackage);
    const published = this.registry.require(canonicalPackage.packageId, canonicalPackage.packageVersion);
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
