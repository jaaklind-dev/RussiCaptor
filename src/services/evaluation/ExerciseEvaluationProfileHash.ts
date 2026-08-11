import type { ExerciseEvaluationProfile } from "@/models/evaluation/ExerciseEvaluation";
import { deepFreeze } from "@/utils/immutable";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

type ProfileInput = Omit<ExerciseEvaluationProfile, "evaluationProfileHash">;
const classificationOrder = { CRITICAL: 0, CORE: 1, INFORMATIVE: 2 } as const;
export function canonicalEvaluationProfile(input: ProfileInput) {
  return {
    ...structuredClone(input),
    dimensions: [...input.dimensions].sort((a, b) => a.displayOrder - b.displayOrder || a.dimensionId.localeCompare(b.dimensionId)).map(dimension => ({
      ...dimension,
      assessmentExpectations: [...dimension.assessmentExpectations].sort((a, b) => classificationOrder[a.classification] - classificationOrder[b.classification] || a.expectationId.localeCompare(b.expectationId)),
      ...(dimension.metricRefs ? { metricRefs: [...dimension.metricRefs].sort() } : {}),
    })),
    ...(input.metadata ? { metadata: { ...input.metadata, ...(input.metadata.tags ? { tags: [...input.metadata.tags].sort() } : {}) } } : {}),
  };
}
export const calculateEvaluationProfileHash = (input: ProfileInput) => sha256Text(stableJson(canonicalEvaluationProfile(input)));
export function createEvaluationProfile(input: ProfileInput): ExerciseEvaluationProfile {
  const canonical = canonicalEvaluationProfile(input);
  return deepFreeze({ ...canonical, evaluationProfileHash: calculateEvaluationProfileHash(canonical) }) as ExerciseEvaluationProfile;
}
