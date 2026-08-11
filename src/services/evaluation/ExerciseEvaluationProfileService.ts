import { ExerciseEvaluationProfileRegistry } from "./ExerciseEvaluationProfileRegistry";
import { evaluationProfileRegistrySeed } from "./ReferenceEvaluationProfiles";
export const exerciseEvaluationProfileRegistry = new ExerciseEvaluationProfileRegistry();
evaluationProfileRegistrySeed.forEach(profile => exerciseEvaluationProfileRegistry.register(profile));
