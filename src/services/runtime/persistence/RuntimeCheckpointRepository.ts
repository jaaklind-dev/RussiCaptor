import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CheckpointPublishResult,
  RuntimeCheckpointEnvelope,
  RuntimeWriterLease,
  WriterAcquisitionResult,
} from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

export interface RuntimeCheckpointRepository {
  loadLatest(exerciseId: string): Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined>;
  acquireWriter(exerciseId: string, writerInstanceId: string, expectedRevision: number, leaseSec: number): Promise<WriterAcquisitionResult>;
  renewWriter(lease: RuntimeWriterLease, leaseSec: number): Promise<WriterAcquisitionResult>;
  releaseWriter(lease: RuntimeWriterLease): Promise<void>;
  publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>>;
}

function code(message: string): string {
  return ["STALE_WRITER", "CHECKPOINT_REVISION_CONFLICT", "WRITER_AUTHORITY_HELD", "TAKEOVER_DENIED"]
    .find(item => message.includes(item)) ?? "AUTHORITY_UNAVAILABLE";
}

export class SupabaseRuntimeCheckpointRepository implements RuntimeCheckpointRepository {
  constructor(private readonly client: SupabaseClient) {}
  async loadLatest(exerciseId: string) {
    const { data, error } = await this.client.from("runtime_checkpoints").select("payload")
      .eq("exercise_id", exerciseId).maybeSingle();
    if (error) throw new Error("AUTHORITY_UNAVAILABLE");
    return data?.payload as RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  }
  async loadWriterLease(exerciseId: string): Promise<RuntimeWriterLease | undefined> {
    const { data, error } = await this.client.from("runtime_writer_leases")
      .select("lease_id,exercise_id,writer_instance_id,writer_user_id,expires_at,released_at")
      .eq("exercise_id", exerciseId).maybeSingle();
    if (error) throw new Error("AUTHORITY_UNAVAILABLE");
    if (!data || data.released_at || Date.parse(data.expires_at) <= Date.now()) return undefined;
    return Object.freeze({
      leaseId: data.lease_id,
      exerciseId: data.exercise_id,
      writerInstanceId: data.writer_instance_id,
      userId: data.writer_user_id,
      expiresAt: data.expires_at,
    });
  }
  async acquireWriter(exerciseId: string, writerInstanceId: string, expectedRevision: number, leaseSec: number): Promise<WriterAcquisitionResult> {
    const { data, error } = await this.client.rpc("acquire_runtime_writer", {
      p_exercise_id: exerciseId, p_writer_instance_id: writerInstanceId,
      p_expected_revision: expectedRevision, p_lease_seconds: leaseSec,
    });
    if (error) return { status: code(error.message) === "WRITER_AUTHORITY_HELD" ? "HELD_BY_OTHER_WRITER" : code(error.message) === "CHECKPOINT_REVISION_CONFLICT" ? "STALE_LOCAL_STATE" : "AUTHORITY_UNAVAILABLE", code: code(error.message) as never };
    const row = Array.isArray(data) ? data[0] : data;
    return { status: row.already_owned ? "ALREADY_OWNED" : "ACQUIRED", checkpointRevision: Number(row.checkpoint_revision), lease: Object.freeze({ leaseId: row.lease_id, exerciseId, writerInstanceId, userId: row.user_id, expiresAt: row.expires_at }) };
  }
  async renewWriter(lease: RuntimeWriterLease, leaseSec: number): Promise<WriterAcquisitionResult> {
    const { data, error } = await this.client.rpc("renew_runtime_writer", { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId, p_lease_seconds: leaseSec });
    if (error) return { status: "AUTHORITY_UNAVAILABLE", code: code(error.message) as never };
    const row = Array.isArray(data) ? data[0] : data;
    return { status: "ALREADY_OWNED", checkpointRevision: Number(row.checkpoint_revision), lease: Object.freeze({ ...lease, expiresAt: row.expires_at }) };
  }
  async releaseWriter(lease: RuntimeWriterLease): Promise<void> {
    const { error } = await this.client.rpc("release_runtime_writer", { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId });
    if (error) throw new Error(code(error.message));
  }
  async publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>> {
    const { data, error } = await this.client.rpc("publish_runtime_checkpoint", { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId, p_expected_revision: expectedRevision, p_checkpoint: checkpoint });
    if (error) {
      const diagnostic = code(error.message);
      return { status: diagnostic === "STALE_WRITER" ? "STALE_CHECKPOINT_WRITER" : diagnostic === "CHECKPOINT_REVISION_CONFLICT" ? "REVISION_CONFLICT" : "AUTHORITY_UNAVAILABLE", code: diagnostic as never };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { status: "PUBLISHED", checkpoint: row.payload as RuntimeCheckpointEnvelope<SharedExerciseState> };
  }
}
