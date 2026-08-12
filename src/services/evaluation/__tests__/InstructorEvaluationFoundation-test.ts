import type { PrincipalState } from "@/models/authorization/Authorization";
import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import { AuthorizationService } from "@/services/authorization/AuthorizationService";
import { InstructorEvaluationService } from "../InstructorEvaluationService";
import { InMemoryInstructorEvaluationRepository } from "../InstructorEvaluationRepository";
import { createInstructorEvaluation, normalizeInstructorEvaluationDraft } from "../InstructorEvaluationModel";

const source = (evaluationHash = "EVAL-HASH", exerciseId = "EX-1"): ExerciseEvaluationResult => ({ evaluationVersion: 1, exerciseId, profileId: "ALS", profileVersion: "1.0.0", profileHash: "PROFILE-HASH", protocolId: "ALS", protocolVersion: "1", protocolHash: "PROTOCOL", assessmentHash: "ASSESSMENT", dimensions: [{ dimensionId: "RESUS", title: "Resuscitation", displayOrder: 1, statusCounts: { MET: 1, NOT_MET: 1, NOT_APPLICABLE: 0, UNAVAILABLE: 0 }, metricResults: [], expectations: [{ expectationId: "EXPECT-CPR", classification: "CRITICAL", assessmentId: "A1", subjectId: "PT-1", patientId: "PT-1", status: "MET", evidence: [] }, { expectationId: "EXPECT-SHOCK", classification: "CORE", assessmentId: "A2", subjectId: "PT-1", patientId: "PT-1", status: "NOT_MET", evidence: [] }] }], diagnostics: [], evaluationHash });
const online: PrincipalState = { state: "AUTHENTICATED", principal: { userId: "USER-1", authenticationState: "AUTHENTICATED", roleAssignments: [{ assignmentId: "ROLE-1", userId: "USER-1", role: "EXCON", scope: { scopeType: "GLOBAL" }, status: "ACTIVE", issuedAt: "2026-08-12T00:00:00Z", issuedBy: "ADMIN" }], permissions: ["INSTRUCTOR_EVALUATION_READ", "INSTRUCTOR_EVALUATION_WRITE"], authorizationFreshness: "VERIFIED_ONLINE", authorizationProvenance: { authority: "SUPABASE_ROLE_ASSIGNMENTS", verifiedAt: "2026-08-12T00:00:01Z", expiresAt: "2026-08-13T00:00:00Z" } } };
const draft = Object.freeze({ dimensionJudgements: Object.freeze([{ dimensionId: "RESUS", judgement: "NEEDS_REVIEW" as const, comment: " Review sequence " }]), expectationJudgements: Object.freeze([{ dimensionId: "RESUS", expectationId: "EXPECT-CPR", subjectId: "PT-1", judgement: "SATISFACTORY" as const, comment: " CPR reviewed " }]), overallComment: " Overall " });

function setup(state = online) {
  const repository = new InMemoryInstructorEvaluationRepository(); const auth = new AuthorizationService({ append: async () => undefined }, () => "2026-08-12T00:00:02Z");
  const service = new InstructorEvaluationService(repository, (principal, permission, context) => auth.authorize(principal, permission, context), () => ({ exerciseId: "EX-1", lifecycleState: "COMPLETED", simulationTimeSec: 10, speed: 1, version: 1 }), (() => { let n = 0; return () => `2026-08-12T00:00:0${++n + 2}Z`; })());
  return { service, repository, state };
}

describe("WP-41 Instructor Evaluation foundation", () => {
  test("creates no automatic human judgements and canonicalizes immutable structured data", () => {
    expect(normalizeInstructorEvaluationDraft({ dimensionJudgements: [], expectationJudgements: [] }, source())).toEqual({ dimensionJudgements: [], expectationJudgements: [] });
    const value = createInstructorEvaluation({ evaluationId: "IE", source: source(), evaluatorUserId: "USER-1", draft, revision: 1, createdAt: "A", updatedAt: "A" });
    expect(value.dimensionJudgements[0]).toMatchObject({ judgement: "NEEDS_REVIEW", comment: "Review sequence" }); expect(value.expectationJudgements[0]).toMatchObject({ judgement: "SATISFACTORY", comment: "CPR reviewed" });
    expect(() => (value.dimensionJudgements as unknown as unknown[]).push({})).toThrow();
  });
  test("accepts human judgement independent of machine MET/NOT_MET and classification", async () => {
    const { service } = setup(); const result = await service.save(online, source(), draft, 0); expect(result.ok).toBe(true);
    const opposite = { ...draft, expectationJudgements: [{ dimensionId: "RESUS", expectationId: "EXPECT-SHOCK", subjectId: "PT-1", judgement: "SATISFACTORY" as const }] };
    expect((await service.save(online, source(), opposite, 1)).ok).toBe(true);
  });
  test("keeps stable identity and append-only revisions with evaluator and source provenance", async () => {
    const { service } = setup(); const first = await service.save(online, source(), draft, 0); const second = await service.save(online, source(), { ...draft, overallComment: "Changed" }, 1);
    expect(first.ok && second.ok && [first.value.evaluation.revision, second.value.evaluation.revision]).toEqual([1, 2]);
    if (second.ok) { expect(second.value.history).toHaveLength(2); expect(second.value.history[0].overallComment).toBe("Overall"); expect(second.value.evaluation).toMatchObject({ evaluationId: "IE-EX-1", evaluator: { userId: "USER-1" }, source: { evaluationHash: "EVAL-HASH" } }); }
  });
  test("persists across a service restart when the persistence repository is retained", async () => {
    const { service, repository } = setup(); await service.save(online, source(), draft, 0);
    const restarted = new InstructorEvaluationService(repository, async (_state, permission, context) => ({ status: "AUTHORIZED", userId: "USER-1", permission, context, freshness: "VERIFIED_ONLINE", assignmentIds: ["ROLE-1"] }), () => ({ exerciseId: "EX-1", lifecycleState: "COMPLETED", simulationTimeSec: 10, speed: 1, version: 1 }));
    const restored = await restarted.read(online, source()); expect(restored.ok && restored.value?.evaluation.revision).toBe(1); expect(restored.ok && restored.value?.evaluation.overallComment).toBe("Overall");
  });
  test("detects stale source and rejects mutation against changed WP-40 evaluation", async () => {
    const { service } = setup(); await service.save(online, source(), draft, 0); const read = await service.read(online, source("CHANGED")); expect(read.ok && read.value?.status).toBe("SOURCE_CHANGED");
    expect(await service.save(online, source("CHANGED"), draft, 1)).toMatchObject({ ok: false, code: "SOURCE_CHANGED" });
  });
  test("enforces optimistic revision conflict without overwriting history", async () => {
    const { service } = setup(); await service.save(online, source(), draft, 0); expect(await service.save(online, source(), draft, 0)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
  });
  test("requires a matching completed exercise", async () => {
    const repository = new InMemoryInstructorEvaluationRepository(); const service = new InstructorEvaluationService(repository, async (_state, permission, context) => ({ status: "AUTHORIZED", userId: "U", permission, context, freshness: "VERIFIED_ONLINE", assignmentIds: [] }), () => ({ exerciseId: "EX-1", lifecycleState: "RUNNING", simulationTimeSec: 1, speed: 1, version: 1 }));
    expect(await service.save(online, source(), draft, 0)).toMatchObject({ ok: false, code: "EXERCISE_NOT_COMPLETED" });
  });
  test.each(["VERIFIED_CACHED", "STALE"] as const)("denies %s authorization for writes", async freshness => {
    const state: PrincipalState = { state: "AUTHENTICATED", principal: { ...online.state === "AUTHENTICATED" ? online.principal : neverValue(), authorizationFreshness: freshness } };
    const { service } = setup(state); expect(await service.save(state, source(), draft, 0)).toMatchObject({ ok: false, code: "AUTHORIZATION_STALE" });
  });
  test("denies unauthenticated and locally forged UI state", async () => {
    const { service } = setup(); expect(await service.save({ state: "UNAUTHENTICATED" }, source(), draft, 0)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    const forged: PrincipalState = { state: "AUTHENTICATED", principal: { ...(online.state === "AUTHENTICATED" ? online.principal : neverValue()), roleAssignments: [], permissions: [] } };
    expect(await service.save(forged, source(), draft, 0)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
  test("validates source IDs, judgement and Unicode comment length", () => {
    expect(() => normalizeInstructorEvaluationDraft({ dimensionJudgements: [{ dimensionId: "NO", judgement: "SATISFACTORY" }], expectationJudgements: [] }, source())).toThrow("Unknown dimension");
    expect(() => normalizeInstructorEvaluationDraft({ dimensionJudgements: [], expectationJudgements: [{ dimensionId: "RESUS", expectationId: "NO", judgement: "SATISFACTORY" }] }, source())).toThrow("Unknown expectation");
    expect(normalizeInstructorEvaluationDraft({ dimensionJudgements: [], expectationJudgements: [], overallComment: "  Õppus ✓  " }, source()).overallComment).toBe("Õppus ✓");
    expect(() => normalizeInstructorEvaluationDraft({ dimensionJudgements: [], expectationJudgements: [], overallComment: "x".repeat(4001) }, source())).toThrow("exceeds");
  });
});

function neverValue(): never { throw new Error("unreachable"); }
