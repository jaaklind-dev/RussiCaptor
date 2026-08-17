import type { AnalyticsReport, MetricResult } from "@/models/analytics/Analytics";
import type { ProtocolAssessmentReport, ProtocolAssessmentResult, ProtocolAssessmentStatus } from "@/models/assessment/ProtocolAssessment";
import { ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE, DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { ALS_GENERIC_V1 } from "@/services/protocol/ReferenceProtocolConfigurations";
import { evaluateExercise } from "../ExerciseEvaluationEngine";
import { createEvaluationProfile } from "../ExerciseEvaluationProfileHash";
import { ExerciseEvaluationProfileRegistry } from "../ExerciseEvaluationProfileRegistry";
import { ExerciseEvaluationProfileValidator } from "../ExerciseEvaluationProfileValidator";
import { ALS_GENERIC_EVALUATION_V1 } from "../ReferenceEvaluationProfiles";

const result = (expectationId: string, status: ProtocolAssessmentStatus, patientId = "PT-001"): ProtocolAssessmentResult => Object.freeze({ assessmentId: `${expectationId}:${patientId}`, expectationId, protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", subjectId: patientId, patientId, status, evidence: Object.freeze([{ sourceType: "TIMELINE_EVENT" as const, sourceId: `${expectationId}-EVENT`, patientId, simulationTimeSec: 2 }]), diagnostics: Object.freeze([]) });
const report = (results: readonly ProtocolAssessmentResult[]): ProtocolAssessmentReport => Object.freeze({ assessmentVersion: 1, exerciseId: "EX-EVALUATION", protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", protocolHash: ALS_GENERIC_V1.protocolHash, sourceDebriefHash: "debrief", results: Object.freeze([...results]), diagnostics: Object.freeze([]), assessmentHash: "assessment-hash" });
const metric = (metricId: string, value: number): MetricResult => Object.freeze({ metricId, metricVersion: "1.0.0", providerId: "assessment.protocol", scope: "EXERCISE", category: "ASSESSMENT", status: "VALUE", value, unit: "RATIO", evidence: Object.freeze([]) });
const analytics = Object.freeze({ metrics: Object.freeze([metric("assessment.completion_ratio", 1), metric("assessment.satisfaction_ratio", 1)]) }) as AnalyticsReport;

describe("WP-40 Exercise Evaluation Profile Foundation", () => {
  test("profile is immutable, exactly versioned and hash deterministic", () => {
    const { evaluationProfileHash: _hash, ...content } = structuredClone(ALS_GENERIC_EVALUATION_V1); const recreated = createEvaluationProfile(content);
    expect(recreated.evaluationProfileHash).toBe(ALS_GENERIC_EVALUATION_V1.evaluationProfileHash);
    expect(Object.isFrozen(ALS_GENERIC_EVALUATION_V1)).toBe(true); expect(Object.isFrozen(ALS_GENERIC_EVALUATION_V1.dimensions[0].assessmentExpectations)).toBe(true);
    expect(() => (ALS_GENERIC_EVALUATION_V1.dimensions as unknown[]).push({})).toThrow();
  });

  test("registry uses exact versions, canonical ordering and rejects duplicates", () => {
    const registry = new ExerciseEvaluationProfileRegistry(); registry.register(ALS_GENERIC_EVALUATION_V1);
    expect(registry.require({ profileId: "ALS_GENERIC_EVALUATION_V1", version: "1.0.0" })).toBe(ALS_GENERIC_EVALUATION_V1);
    expect(() => registry.require({ profileId: "ALS_GENERIC_EVALUATION_V1", version: "2.0.0" })).toThrow("UNKNOWN_EVALUATION_PROFILE");
    expect(() => registry.register(ALS_GENERIC_EVALUATION_V1)).toThrow("DUPLICATE_EVALUATION_PROFILE");
  });

  test("validator fails closed for duplicate dimensions, expectations, missing expectation and wrong protocol", () => {
    const { evaluationProfileHash: _hash, ...content } = structuredClone(ALS_GENERIC_EVALUATION_V1); const invalid = createEvaluationProfile({ ...content, dimensions: [structuredClone(ALS_GENERIC_EVALUATION_V1.dimensions[0]), { ...structuredClone(ALS_GENERIC_EVALUATION_V1.dimensions[0]), assessmentExpectations: [{ expectationId: "UNKNOWN", classification: "INFORMATIVE" }] }] });
    const codes = new Set(new ExerciseEvaluationProfileValidator().validate(invalid, ALS_GENERIC_V1).map(item => item.code));
    expect(codes).toEqual(new Set(["DUPLICATE_DIMENSION", "MISSING_EXPECTATION_REFERENCE"]));
    const wrong = createEvaluationProfile({ ...content, protocolRequirement: { protocolId: "OTHER", version: "1.0.0" } });
    expect(new ExerciseEvaluationProfileValidator().validate(wrong, ALS_GENERIC_V1).map(item => item.code)).toContain("WRONG_PROTOCOL");
    const duplicateRef = createEvaluationProfile({ ...content, dimensions: [{ ...content.dimensions[0], assessmentExpectations: [{ expectationId: "EXPECT-CPR", classification: "CRITICAL" }, { expectationId: "EXPECT-CPR", classification: "CORE" }] }] });
    expect(new ExerciseEvaluationProfileValidator().validate(duplicateRef, ALS_GENERIC_V1).map(item => item.code)).toContain("DUPLICATE_EXPECTATION_REFERENCE");
  });

  test.each(["MET", "NOT_MET", "NOT_APPLICABLE", "UNAVAILABLE"] as const)("preserves WP-38 %s without producing score or pass/fail", status => {
    const evaluation = evaluateExercise(ALS_GENERIC_EVALUATION_V1, report([result("EXPECT-CPR", status), result("EXPECT-SHOCK", "NOT_APPLICABLE")]), analytics);
    expect(evaluation.dimensions[0].expectations.find(item => item.expectationId === "EXPECT-CPR")?.status).toBe(status);
    expect(JSON.stringify(evaluation)).not.toMatch(/score|pass|fail|competent/i);
    expect(evaluation.dimensions[0].expectations.map(item => item.classification)).toEqual(["CRITICAL", "CORE"]);
  });

  test("missing assessment result is explicit UNAVAILABLE accounting and diagnostic, never NOT_MET", () => {
    const evaluation = evaluateExercise(ALS_GENERIC_EVALUATION_V1, report([result("EXPECT-CPR", "MET")]), analytics);
    expect(evaluation.dimensions[0].expectations[1].status).toBe("MISSING");
    expect(evaluation.dimensions[0].statusCounts.UNAVAILABLE).toBe(1);
    expect(evaluation.diagnostics[0].code).toBe("ASSESSMENT_RESULT_MISSING");
  });

  test("assessment permutations produce identical dimensions, evidence and evaluation hash", () => {
    const forward = report([result("EXPECT-CPR", "MET", "PT-002"), result("EXPECT-SHOCK", "NOT_APPLICABLE"), result("EXPECT-CPR", "MET", "PT-001")]);
    const reverse = report([...forward.results].reverse());
    const a = evaluateExercise(ALS_GENERIC_EVALUATION_V1, forward, analytics); const b = evaluateExercise(ALS_GENERIC_EVALUATION_V1, reverse, analytics);
    expect(a.dimensions).toEqual(b.dimensions); expect(a.evaluationHash).toBe(b.evaluationHash);
  });

  test("supports multiple dimensions and informative classification in profile order", () => {
    const { evaluationProfileHash: _hash, ...content } = structuredClone(ALS_GENERIC_EVALUATION_V1);
    const profile = createEvaluationProfile({ ...content, dimensions: [
      { dimensionId: "INFORMATION", title: "Information", displayOrder: 20, assessmentExpectations: [{ expectationId: "EXPECT-SHOCK", classification: "INFORMATIVE" }] },
      { dimensionId: "RESUSCITATION", title: "Resuscitation", displayOrder: 10, assessmentExpectations: [{ expectationId: "EXPECT-CPR", classification: "CRITICAL" }] },
    ] });
    const evaluation = evaluateExercise(profile, report([result("EXPECT-SHOCK", "NOT_APPLICABLE"), result("EXPECT-CPR", "MET")]));
    expect(evaluation.dimensions.map(item => item.dimensionId)).toEqual(["RESUSCITATION", "INFORMATION"]);
    expect(evaluation.dimensions[1].expectations[0].classification).toBe("INFORMATIVE");
  });

  test("ALS package binds exact protocol and evaluation profile while historical packages stay profile-free", () => {
    const loaded = exercisePackageLoader.load(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE);
    expect(loaded.protocolConfiguration).toEqual({ protocolId: "ALS_GENERIC_V1", version: "1.0.0" });
    expect(loaded.evaluationProfile).toEqual({ profileId: "ALS_GENERIC_EVALUATION_V1", version: "1.0.0" });
    expect(loaded.definition.evaluationProfileProvenance?.profileHash).toBe(ALS_GENERIC_EVALUATION_V1.evaluationProfileHash);
    expect(DEFAULT_EXERCISE_PACKAGE.evaluationProfile).toBeUndefined(); expect(DEFAULT_EXERCISE_PACKAGE.definition.evaluationProfileProvenance).toBeUndefined();
    expect(DEFAULT_EXERCISE_PACKAGE.packageHash).toBe("a32f63f6730596a8491279213bd4ac0c7806efe96b157992beeb3183edb266ae");
  });

  test("indexes 500 assessment results without Timeline access or quadratic work", () => {
    const results = Array.from({ length: 500 }, (_, index) => result(index % 2 ? "EXPECT-CPR" : "EXPECT-SHOCK", index % 2 ? "MET" : "NOT_APPLICABLE", `PT-${String(index).padStart(3, "0")}`));
    const started = Date.now(); const evaluation = evaluateExercise(ALS_GENERIC_EVALUATION_V1, report(results), analytics);
    expect(evaluation.dimensions[0].expectations).toHaveLength(500); expect(Date.now() - started).toBeLessThan(500);
  });
});
