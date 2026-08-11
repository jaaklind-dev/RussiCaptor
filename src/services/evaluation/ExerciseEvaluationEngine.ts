import type { AnalyticsReport, MetricResult } from "@/models/analytics/Analytics";
import type { ProtocolAssessmentReport, ProtocolAssessmentResult } from "@/models/assessment/ProtocolAssessment";
import type { EvaluationClassification, EvaluationDiagnostic, EvaluationDimensionResult, EvaluationExpectationResult, EvaluationStatusCounts, ExerciseEvaluationProfile, ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import { deepFreeze } from "@/utils/immutable";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const classificationOrder: Record<EvaluationClassification, number> = { CRITICAL: 0, CORE: 1, INFORMATIVE: 2 };
const counts = (results: readonly EvaluationExpectationResult[]): EvaluationStatusCounts => deepFreeze({ MET: results.filter(item => item.status === "MET").length, NOT_MET: results.filter(item => item.status === "NOT_MET").length, NOT_APPLICABLE: results.filter(item => item.status === "NOT_APPLICABLE").length, UNAVAILABLE: results.filter(item => item.status === "UNAVAILABLE" || item.status === "MISSING").length }) as EvaluationStatusCounts;
const metricKey = (metric: MetricResult) => `${metric.scope}:${metric.subjectId ?? ""}:${metric.metricId}`;
export function evaluateExercise(profile: ExerciseEvaluationProfile, assessment: ProtocolAssessmentReport, analytics?: AnalyticsReport): ExerciseEvaluationResult {
  if (profile.protocolRequirement.protocolId !== assessment.protocolId || profile.protocolRequirement.version !== assessment.protocolVersion) throw new Error("ASSESSMENT_PROFILE_MISMATCH");
  const assessmentIndex = new Map<string, ProtocolAssessmentResult[]>();
  for (const result of assessment.results) { const list = assessmentIndex.get(result.expectationId) ?? []; list.push(result); assessmentIndex.set(result.expectationId, list); }
  const metricIndex = new Map((analytics?.metrics ?? []).map(metric => [metricKey(metric), metric]));
  const diagnostics: EvaluationDiagnostic[] = [];
  const dimensions: EvaluationDimensionResult[] = profile.dimensions.map(dimension => {
    const expectations: EvaluationExpectationResult[] = [];
    for (const reference of dimension.assessmentExpectations) {
      const matched = [...(assessmentIndex.get(reference.expectationId) ?? [])].sort((a, b) => (a.subjectId ?? a.patientId ?? "").localeCompare(b.subjectId ?? b.patientId ?? "") || a.assessmentId.localeCompare(b.assessmentId));
      if (!matched.length) { diagnostics.push({ code: "ASSESSMENT_RESULT_MISSING", message: `Assessment result ${reference.expectationId} is unavailable`, dimensionId: dimension.dimensionId, expectationId: reference.expectationId }); expectations.push({ expectationId: reference.expectationId, classification: reference.classification, status: "MISSING", evidence: [] }); continue; }
      for (const result of matched) expectations.push({ expectationId: result.expectationId, classification: reference.classification, assessmentId: result.assessmentId, ...(result.subjectId ? { subjectId: result.subjectId } : {}), ...(result.patientId ? { patientId: result.patientId } : {}), status: result.status, evidence: [...result.evidence].sort((a, b) => `${a.sourceType}:${a.sourceId ?? a.fieldPath ?? ""}`.localeCompare(`${b.sourceType}:${b.sourceId ?? b.fieldPath ?? ""}`)) });
    }
    expectations.sort((a, b) => classificationOrder[a.classification] - classificationOrder[b.classification] || a.expectationId.localeCompare(b.expectationId) || (a.subjectId ?? a.patientId ?? "").localeCompare(b.subjectId ?? b.patientId ?? ""));
    const metricResults = (dimension.metricRefs ?? []).flatMap(metricId => { const metric = metricIndex.get(`EXERCISE::${metricId}`); if (!metric && analytics) diagnostics.push({ code: "METRIC_RESULT_MISSING", message: `Metric ${metricId} is unavailable`, dimensionId: dimension.dimensionId }); return metric ? [metric] : []; }).sort((a, b) => a.metricId.localeCompare(b.metricId));
    return { dimensionId: dimension.dimensionId, title: dimension.title, displayOrder: dimension.displayOrder, expectations, statusCounts: counts(expectations), metricResults };
  }).sort((a, b) => a.displayOrder - b.displayOrder || a.dimensionId.localeCompare(b.dimensionId));
  diagnostics.sort((a, b) => `${a.dimensionId ?? ""}:${a.expectationId ?? ""}:${a.code}`.localeCompare(`${b.dimensionId ?? ""}:${b.expectationId ?? ""}:${b.code}`));
  const content = { evaluationVersion: 1 as const, exerciseId: assessment.exerciseId, profileId: profile.profileId, profileVersion: profile.version, profileHash: profile.evaluationProfileHash, protocolId: assessment.protocolId, protocolVersion: assessment.protocolVersion, protocolHash: assessment.protocolHash, assessmentHash: assessment.assessmentHash, dimensions, diagnostics };
  return deepFreeze({ ...content, evaluationHash: sha256Text(stableJson(content)) }) as ExerciseEvaluationResult;
}
