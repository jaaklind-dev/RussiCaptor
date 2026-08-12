import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import type { InstructorDimensionJudgement, InstructorEvaluation, InstructorEvaluationDraft, InstructorExpectationJudgement, InstructorJudgement } from "@/models/evaluation/InstructorEvaluation";
import { instructorJudgements } from "@/models/evaluation/InstructorEvaluation";
import { deepFreeze } from "@/utils/immutable";

export const INSTRUCTOR_COMMENT_MAX_LENGTH = 4000;

export class InstructorEvaluationValidationError extends Error {
  constructor(public readonly code: "INVALID_DIMENSION" | "INVALID_EXPECTATION" | "INVALID_JUDGEMENT" | "COMMENT_TOO_LONG", message: string) { super(message); }
}
function comment(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > INSTRUCTOR_COMMENT_MAX_LENGTH) throw new InstructorEvaluationValidationError("COMMENT_TOO_LONG", `Comment exceeds ${INSTRUCTOR_COMMENT_MAX_LENGTH} characters`);
  return normalized;
}
function judgement(value: string): InstructorJudgement {
  if (!instructorJudgements.includes(value as InstructorJudgement)) throw new InstructorEvaluationValidationError("INVALID_JUDGEMENT", "Unsupported instructor judgement");
  return value as InstructorJudgement;
}
function expectationKey(value: Pick<InstructorExpectationJudgement, "expectationId" | "subjectId">): string { return `${value.expectationId}:${value.subjectId ?? ""}`; }

export function normalizeInstructorEvaluationDraft(draft: InstructorEvaluationDraft, source: ExerciseEvaluationResult): InstructorEvaluationDraft {
  const dimensions = new Map(source.dimensions.map(item => [item.dimensionId, item]));
  const dimensionJudgements = draft.dimensionJudgements.map((item): InstructorDimensionJudgement => {
    if (!dimensions.has(item.dimensionId)) throw new InstructorEvaluationValidationError("INVALID_DIMENSION", `Unknown dimension ${item.dimensionId}`);
    return { dimensionId: item.dimensionId, judgement: judgement(item.judgement), ...(comment(item.comment) ? { comment: comment(item.comment) } : {}) };
  }).sort((a, b) => a.dimensionId.localeCompare(b.dimensionId));
  const expectationJudgements = draft.expectationJudgements.map((item): InstructorExpectationJudgement => {
    const dimension = dimensions.get(item.dimensionId);
    if (!dimension) throw new InstructorEvaluationValidationError("INVALID_DIMENSION", `Unknown dimension ${item.dimensionId}`);
    const exists = dimension.expectations.some(candidate => expectationKey(candidate) === expectationKey(item));
    if (!exists) throw new InstructorEvaluationValidationError("INVALID_EXPECTATION", `Unknown expectation ${item.expectationId}`);
    return { dimensionId: item.dimensionId, expectationId: item.expectationId, ...(item.subjectId ? { subjectId: item.subjectId } : {}), judgement: judgement(item.judgement), ...(comment(item.comment) ? { comment: comment(item.comment) } : {}) };
  }).sort((a, b) => a.dimensionId.localeCompare(b.dimensionId) || a.expectationId.localeCompare(b.expectationId) || (a.subjectId ?? "").localeCompare(b.subjectId ?? ""));
  if (new Set(dimensionJudgements.map(item => item.dimensionId)).size !== dimensionJudgements.length) throw new InstructorEvaluationValidationError("INVALID_DIMENSION", "Duplicate dimension judgement");
  if (new Set(expectationJudgements.map(item => `${item.dimensionId}:${expectationKey(item)}`)).size !== expectationJudgements.length) throw new InstructorEvaluationValidationError("INVALID_EXPECTATION", "Duplicate expectation judgement");
  return deepFreeze({ dimensionJudgements, expectationJudgements, ...(comment(draft.overallComment) ? { overallComment: comment(draft.overallComment) } : {}) });
}

export function sourceBinding(source: ExerciseEvaluationResult) {
  return deepFreeze({ evaluationProfileId: source.profileId, evaluationProfileVersion: source.profileVersion, evaluationProfileHash: source.profileHash, evaluationHash: source.evaluationHash });
}

export function createInstructorEvaluation(input: { evaluationId: string; source: ExerciseEvaluationResult; evaluatorUserId: string; draft: InstructorEvaluationDraft; revision: number; createdAt: string; updatedAt: string }): InstructorEvaluation {
  return deepFreeze({ evaluationId: input.evaluationId, schemaVersion: 1 as const, exerciseId: input.source.exerciseId, source: sourceBinding(input.source), evaluator: { userId: input.evaluatorUserId }, ...normalizeInstructorEvaluationDraft(input.draft, input.source), revision: input.revision, createdAt: input.createdAt, updatedAt: input.updatedAt });
}
