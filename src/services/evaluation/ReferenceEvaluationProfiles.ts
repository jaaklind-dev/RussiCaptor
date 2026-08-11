import { createEvaluationProfile } from "./ExerciseEvaluationProfileHash";

export const ALS_GENERIC_EVALUATION_V1 = createEvaluationProfile({
  profileId: "ALS_GENERIC_EVALUATION_V1", version: "1.0.0", title: "ALS Generic Evaluation",
  description: "Exercise-specific categorical interpretation of the ALS Generic protocol assessment.",
  protocolRequirement: { protocolId: "ALS_GENERIC_V1", version: "1.0.0" },
  dimensions: [{ dimensionId: "RESUSCITATION_ACTIONS", title: "Resuscitation Actions", displayOrder: 0,
    assessmentExpectations: [{ expectationId: "EXPECT-CPR", classification: "CRITICAL" }, { expectationId: "EXPECT-SHOCK", classification: "CORE" }],
    metricRefs: ["assessment.completion_ratio", "assessment.satisfaction_ratio"] }],
  metadata: { authority: "RussiCaptor internal reference", tags: ["als", "evaluation", "reference"] },
});
export const evaluationProfileRegistrySeed = [ALS_GENERIC_EVALUATION_V1] as const;
