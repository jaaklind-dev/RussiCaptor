import type { ExerciseCapability } from "@/models/exercise/ExerciseCapability";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { ExerciseProfile } from "@/models/exercise/ExerciseProfile";
import { createExercisePackage } from "./ExercisePackageHash";
import { DEFAULT_EXERCISE_DEFINITION, EXERCISE_DEFINITION_CATALOG } from "./ExerciseDefinitionService";

const capabilities: readonly ExerciseCapability[] = ["EXERCISE_CONTROLS", "TIMELINE", "DEBRIEF", "ANALYTICS", "METRICS", "RESOURCES", "PATIENT_PLAYBACK"];
const processes: Record<ExerciseProfile, readonly string[]> = {
  ALS: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  TRAUMA: ["HEMORRHAGE", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  MASCAL: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  BOTULISM: EXERCISE_DEFINITION_CATALOG.patientProcesses,
  EMERGENCY_DEPARTMENT: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  CUSTOM: EXERCISE_DEFINITION_CATALOG.patientProcesses,
};
const definitions = (profile: ExerciseProfile): ExerciseDefinition => profile === "BOTULISM" ? DEFAULT_EXERCISE_DEFINITION : Object.freeze({
  definitionVersion: 1, exerciseTypeId: `RUSSICAPTOR_${profile}`, name: `${profile.replaceAll("_", " ")} Exercise`, description: `Canonical ${profile.replaceAll("_", " ").toLowerCase()} exercise definition`, profile,
  enabledPatientProcesses: Object.freeze([...processes[profile]]), enabledAnalyticsProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.analyticsProviders]), enabledMetricProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.metricProviders]),
  objectives: Object.freeze([Object.freeze({ objectiveId: "exercise-objective", name: "Complete exercise objectives", description: "Complete the configured clinical and operational exercise objectives" })]), capabilities: Object.freeze([...capabilities]),
});
const template = (profile: ExerciseProfile, author = "RussiCaptor") => { const definition = definitions(profile); return createExercisePackage({ packageId: `russicaptor.${profile.toLowerCase()}`, packageVersion: "1.0.0", definition, patientDatasetId: `patients.${profile.toLowerCase()}.v1`, enabledPatientProcesses: definition.enabledPatientProcesses, enabledAnalyticsProviders: definition.enabledAnalyticsProviders, enabledMetricProviders: definition.enabledMetricProviders, metadata: { name: `${profile.replaceAll("_", " ")} Template Package`, description: `Canonical ${profile.replaceAll("_", " ").toLowerCase()} exercise configuration package`, author, organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: profile, tags: ["canonical", "template", profile.toLowerCase()] } }); };

export const CANONICAL_EXERCISE_PACKAGES = Object.freeze((["ALS", "TRAUMA", "MASCAL", "BOTULISM", "EMERGENCY_DEPARTMENT", "CUSTOM"] as const).map(profile => template(profile)));
export const DEFAULT_EXERCISE_PACKAGE = CANONICAL_EXERCISE_PACKAGES.find(pkg => pkg.definition.profile === "BOTULISM")!;
