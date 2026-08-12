export const instructorJudgements = ["SATISFACTORY", "NEEDS_REVIEW", "NOT_ASSESSED"] as const;
export type InstructorJudgement = (typeof instructorJudgements)[number];

export type InstructorIdentity = Readonly<{ userId: string }>;
export type InstructorDimensionJudgement = Readonly<{
  dimensionId: string;
  judgement: InstructorJudgement;
  comment?: string;
}>;
export type InstructorExpectationJudgement = Readonly<{
  dimensionId: string;
  expectationId: string;
  subjectId?: string;
  judgement: InstructorJudgement;
  comment?: string;
}>;
export type InstructorEvaluationSource = Readonly<{
  evaluationProfileId: string;
  evaluationProfileVersion: string;
  evaluationProfileHash: string;
  evaluationHash: string;
}>;
export type InstructorEvaluation = Readonly<{
  evaluationId: string;
  schemaVersion: 1;
  exerciseId: string;
  source: InstructorEvaluationSource;
  evaluator: InstructorIdentity;
  dimensionJudgements: readonly InstructorDimensionJudgement[];
  expectationJudgements: readonly InstructorExpectationJudgement[];
  overallComment?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;
export type InstructorEvaluationDiagnosticCode =
  | "EVALUATION_NOT_FOUND" | "UNAUTHORIZED" | "AUTHORIZATION_UNAVAILABLE" | "AUTHORIZATION_STALE"
  | "SOURCE_EVALUATION_NOT_FOUND" | "SOURCE_CHANGED" | "INVALID_DIMENSION" | "INVALID_EXPECTATION"
  | "INVALID_JUDGEMENT" | "COMMENT_TOO_LONG" | "REVISION_CONFLICT" | "PERSISTENCE_FAILURE"
  | "EXERCISE_NOT_COMPLETED";

export type InstructorEvaluationView = Readonly<{
  status: "CURRENT" | "SOURCE_CHANGED";
  evaluation: InstructorEvaluation;
  history: readonly InstructorEvaluation[];
}>;

export type InstructorEvaluationDraft = Readonly<{
  dimensionJudgements: readonly InstructorDimensionJudgement[];
  expectationJudgements: readonly InstructorExpectationJudgement[];
  overallComment?: string;
}>;
