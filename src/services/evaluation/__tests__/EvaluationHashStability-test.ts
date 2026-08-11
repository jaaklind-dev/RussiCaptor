import type { ProtocolAssessmentReport } from "@/models/assessment/ProtocolAssessment";
import { ALS_GENERIC_V1 } from "@/services/protocol/ReferenceProtocolConfigurations";
import { evaluateExercise } from "../ExerciseEvaluationEngine";
import { ALS_GENERIC_EVALUATION_V1 } from "../ReferenceEvaluationProfiles";

test("WP-40 profile and evaluation hashes are stable", () => {
  const assessment: ProtocolAssessmentReport = Object.freeze({ assessmentVersion: 1, exerciseId: "HASH", protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", protocolHash: ALS_GENERIC_V1.protocolHash, sourceDebriefHash: "debrief", assessmentHash: "assessment", diagnostics: Object.freeze([]), results: Object.freeze([
    Object.freeze({ assessmentId: "A", expectationId: "EXPECT-CPR", protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", patientId: "PT-001", status: "MET", evidence: Object.freeze([{ sourceType: "TIMELINE_EVENT" as const, sourceId: "CPR", patientId: "PT-001", simulationTimeSec: 2 }]), diagnostics: Object.freeze([]) }),
    Object.freeze({ assessmentId: "B", expectationId: "EXPECT-SHOCK", protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", patientId: "PT-001", status: "NOT_APPLICABLE", evidence: Object.freeze([]), diagnostics: Object.freeze([]) }),
  ]) });
  expect(ALS_GENERIC_EVALUATION_V1.evaluationProfileHash).toBe("1314948c5921ddd60ca1f9b1ff909075a24a77d57f6a6a57f94a93890a33bf32");
  expect(evaluateExercise(ALS_GENERIC_EVALUATION_V1, assessment).evaluationHash).toBe("e04f9f6592699c8258363c36c8a666ce677966cac942746c6b35fd1f00493812");
});
