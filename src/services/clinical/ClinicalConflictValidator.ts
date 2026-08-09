import type { ClinicalModule } from "@/models/clinical/ClinicalModule";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { diagnostic, sortCompositionDiagnostics, type ModuleCompositionDiagnostic, type ModuleCompositionDiagnosticCode } from "./ClinicalCompositionDiagnostics";

type RegistrationKey = Exclude<keyof ClinicalModule["registrations"], "objectives">;
const codes: Record<RegistrationKey, ModuleCompositionDiagnosticCode> = {
  patientProcesses: "DUPLICATE_PATIENT_PROCESS", clinicalEffects: "DUPLICATE_CLINICAL_EFFECT",
  interventions: "DUPLICATE_INTERVENTION", medications: "DUPLICATE_MEDICATION",
  assessmentRules: "DUPLICATE_ASSESSMENT_RULE", analyticsProviders: "DUPLICATE_ANALYTICS_PROVIDER",
  metricProviders: "DUPLICATE_METRIC_PROVIDER", capabilities: "DUPLICATE_CAPABILITY",
  validationRules: "DUPLICATE_VALIDATION_RULE",
};

export class ClinicalConflictValidator {
  validate(modules: readonly ClinicalModule[], base?: ExerciseDefinition): readonly ModuleCompositionDiagnostic[] {
    const diagnostics: ModuleCompositionDiagnostic[] = [];
    const owners = new Map<string, string>();
    const register = (group: RegistrationKey | "objectives", value: string, owner: string, code: ModuleCompositionDiagnosticCode) => {
      const key = `${group}:${value}`; const previous = owners.get(key);
      if (previous) diagnostics.push(diagnostic("ERROR", code, `${value} is registered by both ${previous} and ${owner}`, owner));
      else owners.set(key, owner);
    };
    if (base) {
      base.enabledPatientProcesses.forEach(value => register("patientProcesses", value, "ExerciseDefinition", codes.patientProcesses));
      base.enabledAnalyticsProviders.forEach(value => register("analyticsProviders", value, "ExerciseDefinition", codes.analyticsProviders));
      base.enabledMetricProviders.forEach(value => register("metricProviders", value, "ExerciseDefinition", codes.metricProviders));
      base.capabilities.forEach(value => register("capabilities", value, "ExerciseDefinition", codes.capabilities));
      base.objectives.forEach(value => register("objectives", value.objectiveId, "ExerciseDefinition", "DUPLICATE_OBJECTIVE"));
    }
    for (const module of modules) {
      const owner = `${module.moduleId}@${module.version}`;
      for (const group of Object.keys(codes) as RegistrationKey[]) module.registrations[group].forEach(value => register(group, value, owner, codes[group]));
      module.registrations.objectives.forEach(value => register("objectives", value.objectiveId, owner, "DUPLICATE_OBJECTIVE"));
    }
    return sortCompositionDiagnostics(diagnostics);
  }
}
