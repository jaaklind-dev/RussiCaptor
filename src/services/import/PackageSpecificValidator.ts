import type { ModuleImportIssue, ModuleImportManifest, StagedModule } from "@/models/ModuleImport";

export type PackageValidationContext = Readonly<{
  modules: readonly StagedModule[];
  manifest: ModuleImportManifest;
  exercise: StagedModule;
}>;

export interface PackageSpecificValidator {
  readonly validatorId: string;
  applies(context: PackageValidationContext): boolean;
  validate(context: PackageValidationContext): readonly ModuleImportIssue[];
}

export class PackageSpecificValidatorRegistry {
  constructor(private readonly validators: readonly PackageSpecificValidator[] = []) {}

  validate(context: PackageValidationContext): ModuleImportIssue[] {
    return [...this.validators]
      .sort((a, b) => a.validatorId.localeCompare(b.validatorId))
      .filter((validator) => validator.applies(context))
      .flatMap((validator) => validator.validate(context));
  }
}

