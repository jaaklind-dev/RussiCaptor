import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { ExerciseDefinitionValidator } from "./ExerciseDefinitionValidator";

function immutable<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value as Record<string, unknown>).forEach(immutable); Object.freeze(value); } return value; }
const compare = (a: ExerciseDefinition, b: ExerciseDefinition) => a.exerciseTypeId.localeCompare(b.exerciseTypeId) || a.definitionVersion - b.definitionVersion;
export const exerciseDefinitionKey = (definition: Pick<ExerciseDefinition, "exerciseTypeId" | "definitionVersion">) => `${definition.exerciseTypeId}@${definition.definitionVersion}`;
function canonicalize(input: ExerciseDefinition): ExerciseDefinition { return immutable({ ...structuredClone(input),
  enabledPatientProcesses: [...input.enabledPatientProcesses].sort(), enabledAnalyticsProviders: [...input.enabledAnalyticsProviders].sort(),
  enabledMetricProviders: [...input.enabledMetricProviders].sort(), capabilities: [...input.capabilities].sort(),
  objectives: [...input.objectives].sort((a, b) => a.objectiveId.localeCompare(b.objectiveId)),
  ...(input.clinicalModuleComposition ? { clinicalModuleComposition: {
    modules: [...input.clinicalModuleComposition.modules].sort((a, b) => a.compositionOrder - b.compositionOrder || a.moduleId.localeCompare(b.moduleId) || a.version.localeCompare(b.version)),
    registrations: {
      ...structuredClone(input.clinicalModuleComposition.registrations),
      patientProcesses: [...input.clinicalModuleComposition.registrations.patientProcesses].sort(),
      clinicalEffects: [...input.clinicalModuleComposition.registrations.clinicalEffects].sort(),
      interventions: [...input.clinicalModuleComposition.registrations.interventions].sort(),
      medications: [...input.clinicalModuleComposition.registrations.medications].sort(),
      assessmentRules: [...input.clinicalModuleComposition.registrations.assessmentRules].sort(),
      analyticsProviders: [...input.clinicalModuleComposition.registrations.analyticsProviders].sort(),
      metricProviders: [...input.clinicalModuleComposition.registrations.metricProviders].sort(),
      capabilities: [...input.clinicalModuleComposition.registrations.capabilities].sort(),
      objectives: [...input.clinicalModuleComposition.registrations.objectives].sort((a, b) => a.objectiveId.localeCompare(b.objectiveId)),
      validationRules: [...input.clinicalModuleComposition.registrations.validationRules].sort(),
    },
  } } : {}),
}); }
export const hashExerciseDefinition = (definition: ExerciseDefinition) => sha256Text(stableJson(canonicalize(definition)));

export class ExerciseDefinitionRegistry {
  private readonly byKey = new Map<string, ExerciseDefinition>();
  constructor(private readonly validator: ExerciseDefinitionValidator, definitions: readonly ExerciseDefinition[] = []) { definitions.forEach(definition => this.register(definition)); }
  register(input: ExerciseDefinition): void { this.validator.assertValid(input); const definition = canonicalize(input); const key = exerciseDefinitionKey(definition); if (this.byKey.has(key)) throw new Error(`DUPLICATE_EXERCISE_DEFINITION:${key}`); this.byKey.set(key, definition); }
  get(exerciseTypeId: string, definitionVersion: number): ExerciseDefinition | undefined { return this.byKey.get(`${exerciseTypeId}@${definitionVersion}`); }
  require(exerciseTypeId: string, definitionVersion: number): ExerciseDefinition { const definition = this.get(exerciseTypeId, definitionVersion); if (!definition) throw new Error(`UNKNOWN_EXERCISE_DEFINITION:${exerciseTypeId}@${definitionVersion}`); return definition; }
  get definitions(): readonly ExerciseDefinition[] { return Object.freeze([...this.byKey.values()].sort(compare)); }
}
