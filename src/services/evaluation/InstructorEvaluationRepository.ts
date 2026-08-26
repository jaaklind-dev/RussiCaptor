import type { InstructorEvaluation } from "@/models/evaluation/InstructorEvaluation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";

export type InstructorEvaluationSaveResult = Readonly<{ status: "SAVED"; evaluation: InstructorEvaluation } | { status: "REVISION_CONFLICT" } | { status: "DENIED" } | { status: "FAILURE" }>;
export interface InstructorEvaluationRepository {
  load(exerciseId: string): Promise<readonly InstructorEvaluation[]>;
  save(evaluation: InstructorEvaluation, expectedRevision: number): Promise<InstructorEvaluationSaveResult>;
}
export class SupabaseInstructorEvaluationRepository implements InstructorEvaluationRepository {
  constructor(private readonly client: SupabaseClient) {}
  async load(exerciseId: string): Promise<readonly InstructorEvaluation[]> {
    const { data, error } = await this.client.from("instructor_evaluation_revisions").select("content").eq("exercise_id", exerciseId).order("revision", { ascending: true });
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "instructor_evaluation_revisions.content", data });
    if (error) throw error;
    return Object.freeze((data ?? []).map(row => Object.freeze(row.content as InstructorEvaluation)));
  }
  async save(evaluation: InstructorEvaluation, expectedRevision: number): Promise<InstructorEvaluationSaveResult> {
    const { data, error } = await this.client.rpc("save_instructor_evaluation_revision", { p_evaluation_id: evaluation.evaluationId, p_exercise_id: evaluation.exerciseId, p_expected_revision: expectedRevision, p_source_profile_id: evaluation.source.evaluationProfileId, p_source_profile_version: evaluation.source.evaluationProfileVersion, p_source_profile_hash: evaluation.source.evaluationProfileHash, p_source_evaluation_hash: evaluation.source.evaluationHash, p_content: evaluation });
    recordSupabaseTraffic({ operation: "RPC", endpoint: "save_instructor_evaluation_revision", data });
    if (error) {
      if (error.message.includes("REVISION_CONFLICT")) return { status: "REVISION_CONFLICT" };
      if (error.message.includes("AUTHORIZATION_DENIED")) return { status: "DENIED" };
      return { status: "FAILURE" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row?.content ? { status: "SAVED", evaluation: Object.freeze(row.content as InstructorEvaluation) } : { status: "FAILURE" };
  }
}

export class InMemoryInstructorEvaluationRepository implements InstructorEvaluationRepository {
  private readonly values = new Map<string, InstructorEvaluation[]>();
  async load(exerciseId: string) { return Object.freeze([...(this.values.get(exerciseId) ?? [])]); }
  async save(evaluation: InstructorEvaluation, expectedRevision: number): Promise<InstructorEvaluationSaveResult> {
    const history = this.values.get(evaluation.exerciseId) ?? [];
    if ((history.at(-1)?.revision ?? 0) !== expectedRevision) return { status: "REVISION_CONFLICT" };
    history.push(evaluation); this.values.set(evaluation.exerciseId, history); return { status: "SAVED", evaluation };
  }
}
