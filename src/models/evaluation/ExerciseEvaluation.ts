import type { MetricResult } from "@/models/analytics/Analytics";
import type { ProtocolAssessmentResult, ProtocolAssessmentStatus } from "@/models/assessment/ProtocolAssessment";

export type EvaluationClassification = "CRITICAL" | "CORE" | "INFORMATIVE";
export type EvaluationProfileReference = Readonly<{ profileId: string; version: string }>;
export type EvaluationExpectationReference = Readonly<{ expectationId: string; classification: EvaluationClassification }>;
export type EvaluationDimension = Readonly<{
  dimensionId: string;
  title: string;
  description?: string;
  displayOrder: number;
  assessmentExpectations: readonly EvaluationExpectationReference[];
  metricRefs?: readonly string[];
}>;
export type ExerciseEvaluationProfile = Readonly<{
  profileId: string;
  version: string;
  title: string;
  description?: string;
  protocolRequirement: Readonly<{ protocolId: string; version: string }>;
  dimensions: readonly EvaluationDimension[];
  metadata?: Readonly<{ authority?: string; tags?: readonly string[] }>;
  evaluationProfileHash: string;
}>;
export type EvaluationProfileProvenance = Readonly<{
  profileId: string;
  version: string;
  profileHash: string;
  title: string;
  protocolId: string;
  protocolVersion: string;
}>;
export type EvaluationDiagnosticCode = "ASSESSMENT_RESULT_MISSING" | "METRIC_RESULT_MISSING" | "ASSESSMENT_PROFILE_MISMATCH";
export type EvaluationDiagnostic = Readonly<{ code: EvaluationDiagnosticCode; message: string; dimensionId?: string; expectationId?: string; subjectId?: string }>;
export type EvaluationStatusCounts = Readonly<Record<ProtocolAssessmentStatus, number>>;
export type EvaluationExpectationResult = Readonly<{
  expectationId: string;
  classification: EvaluationClassification;
  assessmentId?: string;
  subjectId?: string;
  patientId?: string;
  status: ProtocolAssessmentStatus | "MISSING";
  evidence: ProtocolAssessmentResult["evidence"];
}>;
export type EvaluationDimensionResult = Readonly<{
  dimensionId: string;
  title: string;
  displayOrder: number;
  expectations: readonly EvaluationExpectationResult[];
  statusCounts: EvaluationStatusCounts;
  metricResults: readonly MetricResult[];
}>;
export type ExerciseEvaluationResult = Readonly<{
  evaluationVersion: 1;
  exerciseId: string;
  profileId: string;
  profileVersion: string;
  profileHash: string;
  protocolId: string;
  protocolVersion: string;
  protocolHash: string;
  assessmentHash: string;
  dimensions: readonly EvaluationDimensionResult[];
  diagnostics: readonly EvaluationDiagnostic[];
  evaluationHash: string;
}>;
