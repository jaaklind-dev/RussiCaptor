import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getExerciseEvaluationResult } from "./ExerciseEvaluationService";
import { authorizeCurrentPrincipal, getAuthorizationPrincipal, refreshAuthorizationPrincipal } from "./AuthorizationFoundationService";
import { supabase } from "./SupabaseService";
import { InstructorEvaluationService } from "./evaluation/InstructorEvaluationService";
import { InMemoryInstructorEvaluationRepository, SupabaseInstructorEvaluationRepository } from "./evaluation/InstructorEvaluationRepository";
import type { InstructorEvaluationDraft } from "@/models/evaluation/InstructorEvaluation";

const repository = supabase ? new SupabaseInstructorEvaluationRepository(supabase) : new InMemoryInstructorEvaluationRepository();
export const instructorEvaluationService = new InstructorEvaluationService(repository, (_state, permission, context) => authorizeCurrentPrincipal(permission, context), getCanonicalExerciseSnapshot);

export async function loadCurrentInstructorEvaluation() {
  const source = getExerciseEvaluationResult();
  if (!source) return { ok: false as const, code: "SOURCE_EVALUATION_NOT_FOUND" as const, message: "No WP-40 source evaluation" };
  const principal = await refreshAuthorizationPrincipal();
  return instructorEvaluationService.read(principal, source);
}
export async function loadInstructorEvaluationAccess() {
  const source = getExerciseEvaluationResult();
  if (!source) return { source: undefined, read: { ok: false as const, code: "SOURCE_EVALUATION_NOT_FOUND" as const, message: "No WP-40 source evaluation" }, canWrite: false };
  const principal = await refreshAuthorizationPrincipal();
  const read = await instructorEvaluationService.read(principal, source);
  const write = await authorizeCurrentPrincipal("INSTRUCTOR_EVALUATION_WRITE", { exerciseId: source.exerciseId });
  return { source, read, canWrite: write.status === "AUTHORIZED" };
}
export async function saveCurrentInstructorEvaluation(draft: InstructorEvaluationDraft, expectedRevision: number) {
  const principal = await refreshAuthorizationPrincipal();
  return instructorEvaluationService.save(principal, getExerciseEvaluationResult(), draft, expectedRevision);
}
export function currentAuthorizationPrincipal() { return getAuthorizationPrincipal(); }
