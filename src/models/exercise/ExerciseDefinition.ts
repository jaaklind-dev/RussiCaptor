import type { ExerciseCapability } from "./ExerciseCapability";
import type { ExerciseObjective } from "./ExerciseObjective";
import type { ExerciseProfile } from "./ExerciseProfile";

export type ExerciseDefinition = Readonly<{
  definitionVersion: number;
  exerciseTypeId: string;
  name: string;
  description: string;
  profile: ExerciseProfile;
  enabledPatientProcesses: readonly string[];
  enabledAnalyticsProviders: readonly string[];
  enabledMetricProviders: readonly string[];
  objectives: readonly ExerciseObjective[];
  capabilities: readonly ExerciseCapability[];
}>;

export type ExerciseDefinitionCatalog = Readonly<{
  patientProcesses: readonly string[];
  analyticsProviders: readonly string[];
  metricProviders: readonly string[];
}>;
