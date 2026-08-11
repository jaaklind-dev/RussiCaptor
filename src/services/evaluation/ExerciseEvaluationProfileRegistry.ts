import type { EvaluationProfileReference, ExerciseEvaluationProfile } from "@/models/evaluation/ExerciseEvaluation";
import { ExerciseEvaluationProfileValidator } from "./ExerciseEvaluationProfileValidator";

const key = (value: EvaluationProfileReference) => `${value.profileId}@${value.version}`;
export class ExerciseEvaluationProfileRegistry {
  private readonly values = new Map<string, ExerciseEvaluationProfile>();
  constructor(private readonly validator = new ExerciseEvaluationProfileValidator()) {}
  register(profile: ExerciseEvaluationProfile) { this.validator.assertValid(profile); const identity = key(profile); if (this.values.has(identity)) throw new Error(`DUPLICATE_EVALUATION_PROFILE:${identity}`); this.values.set(identity, profile); return profile; }
  get(reference: EvaluationProfileReference) { return this.values.get(key(reference)); }
  require(reference: EvaluationProfileReference) { const value = this.get(reference); if (!value) throw new Error(`UNKNOWN_EVALUATION_PROFILE:${key(reference)}`); return value; }
  list(): readonly ExerciseEvaluationProfile[] { return Object.freeze([...this.values.values()].sort((a, b) => a.profileId.localeCompare(b.profileId) || a.version.localeCompare(b.version))); }
}
