import type { AuthorizationDecision, PrincipalState } from "@/models/authorization/Authorization";
import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import type { InstructorEvaluationDraft, InstructorEvaluationView } from "@/models/evaluation/InstructorEvaluation";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { createInstructorEvaluation, InstructorEvaluationValidationError } from "./InstructorEvaluationModel";
import type { InstructorEvaluationRepository } from "./InstructorEvaluationRepository";

export type InstructorEvaluationFailureCode = InstructorEvaluationValidationError["code"] | "EVALUATION_NOT_FOUND" | "UNAUTHORIZED" | "AUTHORIZATION_UNAVAILABLE" | "AUTHORIZATION_STALE" | "SOURCE_EVALUATION_NOT_FOUND" | "SOURCE_CHANGED" | "REVISION_CONFLICT" | "PERSISTENCE_FAILURE" | "EXERCISE_NOT_COMPLETED";
export type InstructorEvaluationResult<T> = Readonly<{ ok: true; value: T } | { ok: false; code: InstructorEvaluationFailureCode; message: string }>;
type Authorizer = (state: PrincipalState, permission: "INSTRUCTOR_EVALUATION_READ" | "INSTRUCTOR_EVALUATION_WRITE", context: { exerciseId: string }) => Promise<AuthorizationDecision>;

function failure<T>(code: InstructorEvaluationFailureCode, message: string = code): InstructorEvaluationResult<T> { return Object.freeze({ ok: false, code, message }); }
function authorizationFailure<T>(decision: Extract<AuthorizationDecision, { status: "DENIED" }>): InstructorEvaluationResult<T> {
  const code = decision.reason === "AUTHORIZATION_STALE" ? "AUTHORIZATION_STALE" : decision.reason === "AUTHORIZATION_UNAVAILABLE" ? "AUTHORIZATION_UNAVAILABLE" : "UNAUTHORIZED";
  return failure(code, decision.reason);
}

export class InstructorEvaluationService {
  constructor(private readonly repository: InstructorEvaluationRepository, private readonly authorize: Authorizer, private readonly snapshot: () => CanonicalExerciseSnapshot, private readonly now = () => new Date().toISOString()) {}

  async read(state: PrincipalState, source: ExerciseEvaluationResult): Promise<InstructorEvaluationResult<InstructorEvaluationView | undefined>> {
    const decision = await this.authorize(state, "INSTRUCTOR_EVALUATION_READ", { exerciseId: source.exerciseId });
    if (decision.status === "DENIED") return authorizationFailure(decision);
    try {
      const history = await this.repository.load(source.exerciseId); const evaluation = history.at(-1);
      if (!evaluation) return Object.freeze({ ok: true, value: undefined });
      if (evaluation.exerciseId !== source.exerciseId) return failure("SOURCE_CHANGED", "Exercise binding changed");
      return Object.freeze({ ok: true, value: Object.freeze({ status: evaluation.source.evaluationHash === source.evaluationHash ? "CURRENT" : "SOURCE_CHANGED", evaluation, history }) });
    } catch { return failure("PERSISTENCE_FAILURE"); }
  }

  async save(state: PrincipalState, source: ExerciseEvaluationResult | undefined, draft: InstructorEvaluationDraft, expectedRevision: number): Promise<InstructorEvaluationResult<InstructorEvaluationView>> {
    if (!source) return failure("SOURCE_EVALUATION_NOT_FOUND");
    const currentSnapshot = this.snapshot();
    if (currentSnapshot.exerciseId !== source.exerciseId || currentSnapshot.lifecycleState !== "COMPLETED") return failure("EXERCISE_NOT_COMPLETED", "Instructor Evaluation writes require the matching completed exercise");
    const decision = await this.authorize(state, "INSTRUCTOR_EVALUATION_WRITE", { exerciseId: source.exerciseId });
    if (decision.status === "DENIED") return authorizationFailure(decision);
    try {
      const history = await this.repository.load(source.exerciseId); const current = history.at(-1);
      if ((current?.revision ?? 0) !== expectedRevision) return failure("REVISION_CONFLICT");
      if (current && current.source.evaluationHash !== source.evaluationHash) return failure("SOURCE_CHANGED");
      const timestamp = this.now();
      const evaluation = createInstructorEvaluation({ evaluationId: current?.evaluationId ?? `IE-${source.exerciseId}`, source, evaluatorUserId: decision.userId, draft, revision: expectedRevision + 1, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp });
      const saved = await this.repository.save(evaluation, expectedRevision);
      if (saved.status === "REVISION_CONFLICT") return failure("REVISION_CONFLICT");
      if (saved.status === "DENIED") return failure("UNAUTHORIZED");
      if (saved.status !== "SAVED") return failure("PERSISTENCE_FAILURE");
      const nextHistory = Object.freeze([...history, saved.evaluation]);
      return Object.freeze({ ok: true, value: Object.freeze({ status: "CURRENT", evaluation: saved.evaluation, history: nextHistory }) });
    } catch (error) {
      if (error instanceof InstructorEvaluationValidationError) return failure(error.code, error.message);
      return failure("PERSISTENCE_FAILURE");
    }
  }
}
