import type { ClinicalModuleComposition, ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";
import type { ClinicalModuleDependency } from "@/models/clinical/ClinicalModuleDependency";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { ExerciseCapability } from "@/models/exercise/ExerciseCapability";
import { deepFreeze } from "@/utils/immutable";
import { ClinicalConflictValidator } from "./ClinicalConflictValidator";
import { diagnostic, sortCompositionDiagnostics, type ModuleCompositionDiagnostic } from "./ClinicalCompositionDiagnostics";
import { ClinicalDependencyResolver } from "./ClinicalDependencyResolver";
import type { ClinicalModuleRegistry } from "./ClinicalModuleRegistry";

export type ClinicalModuleCompositionResult = Readonly<
  | { ok: true; definition: ExerciseDefinition; composition: ClinicalModuleComposition; diagnostics: readonly ModuleCompositionDiagnostic[] }
  | { ok: false; diagnostics: readonly ModuleCompositionDiagnostic[] }
>;

const unique = <T extends string>(values: readonly T[]): readonly T[] => Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));

export class ClinicalModuleComposer {
  private readonly resolver: ClinicalDependencyResolver;
  private readonly conflicts = new ClinicalConflictValidator();

  constructor(registry: ClinicalModuleRegistry) { this.resolver = new ClinicalDependencyResolver(registry); }

  compose(base: ExerciseDefinition, required: readonly ClinicalModuleDependency[]): ClinicalModuleCompositionResult {
    const resolution = this.resolver.resolve(required);
    if (resolution.diagnostics.some(item => item.severity === "ERROR")) return Object.freeze({ ok: false, diagnostics: resolution.diagnostics });
    const conflicts = this.conflicts.validate(resolution.modules, base);
    if (conflicts.length) return Object.freeze({ ok: false, diagnostics: conflicts });
    const registrations: ClinicalModuleRegistrations = {
      patientProcesses: unique(resolution.modules.flatMap(module => module.registrations.patientProcesses)),
      clinicalEffects: unique(resolution.modules.flatMap(module => module.registrations.clinicalEffects)),
      interventions: unique(resolution.modules.flatMap(module => module.registrations.interventions)),
      medications: unique(resolution.modules.flatMap(module => module.registrations.medications)),
      assessmentRules: unique(resolution.modules.flatMap(module => module.registrations.assessmentRules)),
      analyticsProviders: unique(resolution.modules.flatMap(module => module.registrations.analyticsProviders)),
      metricProviders: unique(resolution.modules.flatMap(module => module.registrations.metricProviders)),
      capabilities: unique(resolution.modules.flatMap(module => module.registrations.capabilities)),
      objectives: Object.freeze(resolution.modules.flatMap(module => module.registrations.objectives).sort((left, right) => left.objectiveId.localeCompare(right.objectiveId))),
      validationRules: unique(resolution.modules.flatMap(module => module.registrations.validationRules)),
    };
    const composition: ClinicalModuleComposition = {
      modules: resolution.modules.map((module, compositionOrder) => Object.freeze({ moduleId: module.moduleId, version: module.version, moduleHash: module.moduleHash, compositionOrder })),
      registrations,
    };
    const definition: ExerciseDefinition = {
      ...structuredClone(base),
      enabledPatientProcesses: unique([...base.enabledPatientProcesses, ...registrations.patientProcesses]),
      enabledAnalyticsProviders: unique([...base.enabledAnalyticsProviders, ...registrations.analyticsProviders]),
      enabledMetricProviders: unique([...base.enabledMetricProviders, ...registrations.metricProviders]),
      capabilities: unique([...base.capabilities, ...registrations.capabilities]) as readonly ExerciseCapability[],
      objectives: Object.freeze([...base.objectives, ...registrations.objectives].sort((left, right) => left.objectiveId.localeCompare(right.objectiveId))),
      clinicalModuleComposition: composition,
    };
    return deepFreeze({ ok: true, definition, composition, diagnostics: sortCompositionDiagnostics([
      diagnostic("INFO", "COMPOSITION_COMPLETE", `Composed ${composition.modules.length} Clinical Modules`),
    ]) }) as ClinicalModuleCompositionResult;
  }
}
