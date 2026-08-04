import { EXERCISE_CAPABILITIES } from "@/models/exercise/ExerciseCapability";
import type { ExerciseDefinition, ExerciseDefinitionCatalog } from "@/models/exercise/ExerciseDefinition";
import { EXERCISE_PROFILES } from "@/models/exercise/ExerciseProfile";

export type ExerciseDefinitionValidationCode = "INVALID_VERSION" | "INVALID_ID" | "UNKNOWN_PROFILE" | "DUPLICATE_VALUE" | "UNKNOWN_PATIENT_PROCESS" | "UNKNOWN_ANALYTICS_PROVIDER" | "UNKNOWN_METRIC_PROVIDER" | "UNKNOWN_CAPABILITY" | "INVALID_OBJECTIVE";
export type ExerciseDefinitionValidationIssue = Readonly<{ code: ExerciseDefinitionValidationCode; path: string; message: string }>;

const duplicates = (values: readonly string[]) => values.filter((value, index) => values.indexOf(value) !== index);
const unknown = (values: readonly string[], known: readonly string[]) => values.filter(value => !known.includes(value));

export class ExerciseDefinitionValidator {
  constructor(private readonly catalog: ExerciseDefinitionCatalog) {}
  validate(definition: ExerciseDefinition): readonly ExerciseDefinitionValidationIssue[] {
    const issues: ExerciseDefinitionValidationIssue[] = [];
    const add = (code: ExerciseDefinitionValidationCode, path: string, message: string) => issues.push(Object.freeze({ code, path, message }));
    if (!Number.isSafeInteger(definition.definitionVersion) || definition.definitionVersion < 1) add("INVALID_VERSION", "definitionVersion", "Definition version must be a positive integer");
    if (!definition.exerciseTypeId?.trim()) add("INVALID_ID", "exerciseTypeId", "Exercise type ID is required");
    if (!EXERCISE_PROFILES.includes(definition.profile)) add("UNKNOWN_PROFILE", "profile", `Unknown profile ${definition.profile}`);
    const collections = [
      ["enabledPatientProcesses", definition.enabledPatientProcesses], ["enabledAnalyticsProviders", definition.enabledAnalyticsProviders],
      ["enabledMetricProviders", definition.enabledMetricProviders], ["capabilities", definition.capabilities],
      ["objectives", definition.objectives.map(item => item.objectiveId)],
    ] as const;
    for (const [path, values] of collections) for (const value of [...new Set(duplicates(values))].sort()) add("DUPLICATE_VALUE", path, `Duplicate value ${value}`);
    for (const value of unknown(definition.enabledPatientProcesses, this.catalog.patientProcesses)) add("UNKNOWN_PATIENT_PROCESS", "enabledPatientProcesses", `Unknown PatientProcess ${value}`);
    for (const value of unknown(definition.enabledAnalyticsProviders, this.catalog.analyticsProviders)) add("UNKNOWN_ANALYTICS_PROVIDER", "enabledAnalyticsProviders", `Unknown analytics provider ${value}`);
    for (const value of unknown(definition.enabledMetricProviders, this.catalog.metricProviders)) add("UNKNOWN_METRIC_PROVIDER", "enabledMetricProviders", `Unknown metric provider ${value}`);
    for (const value of definition.capabilities.filter(value => !EXERCISE_CAPABILITIES.includes(value))) add("UNKNOWN_CAPABILITY", "capabilities", `Unknown capability ${value}`);
    definition.objectives.forEach((objective, index) => { if (!objective.objectiveId?.trim() || !objective.name?.trim() || !objective.description?.trim()) add("INVALID_OBJECTIVE", `objectives[${index}]`, "Objective ID, name and description are required"); });
    return Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)));
  }
  assertValid(definition: ExerciseDefinition): void { const issues = this.validate(definition); if (issues.length) throw new Error(`INVALID_EXERCISE_DEFINITION:${issues.map(issue => `${issue.code}@${issue.path}`).join(",")}`); }
}
