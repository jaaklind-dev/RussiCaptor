import type { ExerciseDefinition, ExerciseDefinitionCatalog } from "@/models/exercise/ExerciseDefinition";
import type { ExerciseCapability } from "@/models/exercise/ExerciseCapability";
import { ExerciseDefinitionRegistry } from "./ExerciseDefinitionRegistry";
import { ExerciseDefinitionValidator } from "./ExerciseDefinitionValidator";

export const EXERCISE_DEFINITION_CATALOG: ExerciseDefinitionCatalog = Object.freeze({
  patientProcesses: Object.freeze(["BOTULISM_ROOT", "CARDIAC_ARREST", "HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "PLEURAL_INJURY", "RESPIRATORY_FAILURE"]),
  analyticsProviders: Object.freeze(["core.exercise", "core.interventions", "core.ownership", "core.patient-flow", "core.resources", "core.timeline"]),
  metricProviders: Object.freeze(["core.exercise", "core.interventions", "core.ownership", "core.patient-flow", "core.resources", "core.timeline"]),
});
export const DEFAULT_EXERCISE_DEFINITION: ExerciseDefinition = Object.freeze({
  definitionVersion: 1, exerciseTypeId: "RUSSICAPTOR_DEMO", name: "RussiCaptor Demo Exercise", description: "Canonical development and botulism exercise definition", profile: "BOTULISM",
  enabledPatientProcesses: Object.freeze(EXERCISE_DEFINITION_CATALOG.patientProcesses.filter(id => id !== "CARDIAC_ARREST" && id !== "PLEURAL_INJURY")), enabledAnalyticsProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.analyticsProviders]), enabledMetricProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.metricProviders]),
  objectives: Object.freeze([
    Object.freeze({ objectiveId: "recognize-deterioration", name: "Recognize deterioration", description: "Recognize clinically relevant patient deterioration" }),
    Object.freeze({ objectiveId: "maintain-ownership", name: "Maintain ownership", description: "Maintain explicit patient ownership and safe handovers" }),
    Object.freeze({ objectiveId: "use-resources", name: "Use resources", description: "Use available clinical resources during the exercise" }),
  ]), capabilities: Object.freeze<ExerciseCapability[]>(["EXERCISE_CONTROLS", "TIMELINE", "DEBRIEF", "ANALYTICS", "METRICS", "RESOURCES", "PATIENT_PLAYBACK"]),
});
export const exerciseDefinitionRegistry = new ExerciseDefinitionRegistry(new ExerciseDefinitionValidator(EXERCISE_DEFINITION_CATALOG), [DEFAULT_EXERCISE_DEFINITION]);
