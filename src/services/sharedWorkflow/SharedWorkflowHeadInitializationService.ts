import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/services/SupabaseService";
import { observeSharedWorkflowHead } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

export type SharedWorkflowHeadInitializationResult = Readonly<{
  status: "INITIALIZED" | "EXISTING";
  revision: number;
  ownerUserId?: string;
}>;

export interface SharedWorkflowHeadInitializationGateway {
  ensure(exerciseId: string, patientId: string): Promise<SharedWorkflowHeadInitializationResult>;
}

export class SupabaseSharedWorkflowHeadInitializationGateway implements SharedWorkflowHeadInitializationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async ensure(exerciseId: string, patientId: string): Promise<SharedWorkflowHeadInitializationResult> {
    const { data, error } = await this.client.rpc("ensure_shared_workflow_patient_head", {
      p_exercise_id: exerciseId,
      p_patient_id: patientId,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as {
      status?: string;
      revision?: number;
      owner_user_id?: string;
    } | null;
    if ((row?.status !== "INITIALIZED" && row?.status !== "EXISTING") ||
      !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0) {
      throw new Error("WORKFLOW_HEAD_INITIALIZATION_INVALID_RESPONSE");
    }
    return Object.freeze({
      status: row.status,
      revision: Number(row.revision),
      ownerUserId: row.owner_user_id ?? undefined,
    });
  }
}

let gateway: SharedWorkflowHeadInitializationGateway | undefined = supabase
  ? new SupabaseSharedWorkflowHeadInitializationGateway(supabase)
  : undefined;

export function setSharedWorkflowHeadInitializationGateway(
  value: SharedWorkflowHeadInitializationGateway | undefined,
): void {
  gateway = value;
}

export async function ensureSharedWorkflowPatientHeads(
  exerciseId: string,
  patientIds: readonly string[],
): Promise<readonly SharedWorkflowHeadInitializationResult[]> {
  if (!gateway) throw new Error("WORKFLOW_HEAD_INITIALIZATION_UNAVAILABLE");
  const uniquePatientIds = [...new Set(patientIds)];
  if (!exerciseId || uniquePatientIds.length === 0 || uniquePatientIds.some(patientId => !patientId)) {
    throw new Error("WORKFLOW_HEAD_INITIALIZATION_INVALID_INPUT");
  }
  const results = await Promise.all(uniquePatientIds.map(patientId => gateway!.ensure(exerciseId, patientId)));
  results.forEach((result, index) => {
    observeSharedWorkflowHead(exerciseId, uniquePatientIds[index], result.revision, result.ownerUserId);
  });
  return Object.freeze(results);
}
