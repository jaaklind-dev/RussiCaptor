import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CheckpointPublishResult,
  RuntimeCheckpointEnvelope,
  RuntimeWriterLease,
  WriterAcquisitionResult,
} from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { estimateSupabasePayloadBytes, recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { parseRuntimeCheckpointMetadata, type RuntimeCheckpointMetadata } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import { createRuntimeCheckpointDelta, type RuntimeCheckpointDelta } from "@/services/runtime/persistence/RuntimeCheckpointDeltaService";

export interface RuntimeCheckpointRepository {
  loadLatest(exerciseId: string, trafficEndpoint?: string): Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined>;
  loadLatestMetadata(exerciseId: string, trafficEndpoint?: string): Promise<RuntimeCheckpointMetadata | undefined>;
  loadDeltas(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDelta[]>;
  loadDeltaMetadata(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDeltaMetadata[]>;
  acquireWriter(exerciseId: string, writerInstanceId: string, expectedRevision: number, leaseSec: number): Promise<WriterAcquisitionResult>;
  renewWriter(lease: RuntimeWriterLease, leaseSec: number): Promise<WriterAcquisitionResult>;
  releaseWriter(lease: RuntimeWriterLease): Promise<void>;
  publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>>;
}

export type RuntimeCheckpointDeltaMetadata = Readonly<{
  fromRevision: number;
  toRevision: number;
  baseHash: string;
  targetHash: string;
  provenanceHash: string;
  deltaVersion: number;
  persistedRuntimeVersion: number;
  payloadBytes: number;
}>;

export type RuntimeCheckpointFreshness = Readonly<{
  exerciseId: string;
  checkpointRevision: number;
  payloadHash: string;
  provenanceHash: string;
  writerInstanceId?: string;
  updatedAt?: string;
}>;

/** Metadata is the freshness source; a full payload is a fail-safe rollout fallback only. */
export async function loadCheckpointFreshness(
  repository: Pick<RuntimeCheckpointRepository, "loadLatest" | "loadLatestMetadata">,
  exerciseId: string,
  purpose: "takeover" | "recovery" | "cas",
): Promise<RuntimeCheckpointFreshness | undefined> {
  try {
    const metadata = await repository.loadLatestMetadata(exerciseId, `runtime_checkpoint_notifications.${purpose}_metadata`);
    if (metadata) {
      recordSupabaseTraffic({ operation: "FULL_PAYLOAD_AVOIDED", endpoint: `runtime_checkpoints.${purpose}` });
      return metadata;
    }
  } catch {
    // An older rollout or unavailable metadata row must never weaken freshness checks.
  }
  recordSupabaseTraffic({ operation: "METADATA_FALLBACK", endpoint: `runtime_checkpoints.${purpose}` });
  const checkpoint = await repository.loadLatest(exerciseId, `runtime_checkpoints.${purpose}_fallback_payload`);
  return checkpoint ? Object.freeze({
    exerciseId: checkpoint.exerciseId,
    checkpointRevision: checkpoint.checkpointRevision,
    payloadHash: checkpoint.payloadHash,
    provenanceHash: checkpoint.provenanceHash,
  }) : undefined;
}

function code(message: string): string {
  return ["STALE_WRITER", "CHECKPOINT_REVISION_CONFLICT", "WRITER_AUTHORITY_HELD", "TAKEOVER_DENIED"]
    .find(item => message.includes(item)) ?? "AUTHORITY_UNAVAILABLE";
}

export class SupabaseRuntimeCheckpointRepository implements RuntimeCheckpointRepository {
  constructor(private readonly client: SupabaseClient) {}
  async loadLatest(exerciseId: string, trafficEndpoint = "runtime_checkpoints.payload") {
    const { data, error } = await this.client.from("runtime_checkpoints").select("payload")
      .eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: trafficEndpoint, data, fullSnapshot: true });
    if (error) throw new Error("AUTHORITY_UNAVAILABLE");
    return data?.payload as RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  }
  async loadLatestMetadata(exerciseId: string, trafficEndpoint = "runtime_checkpoint_notifications.metadata"): Promise<RuntimeCheckpointMetadata | undefined> {
    const { data, error } = await this.client.from("runtime_checkpoint_notifications")
      .select("exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at,checkpoint_bytes")
      .eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: trafficEndpoint, data });
    if (error) throw new Error("AUTHORITY_UNAVAILABLE");
    return parseRuntimeCheckpointMetadata(data);
  }
  async loadDeltaMetadata(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDeltaMetadata[]> {
    const { data, error } = await this.client.from("runtime_checkpoint_deltas")
      .select("from_revision,to_revision,base_hash,target_hash,provenance_hash,delta_version,persisted_runtime_version,payload_bytes")
      .eq("exercise_id", exerciseId).gte("to_revision", fromRevision + 1).lte("to_revision", toRevision)
      .order("to_revision", { ascending: true }).limit(limit);
    recordSupabaseTraffic({ operation: "DELTA_COST_METADATA_QUERY", endpoint: "runtime_checkpoint_deltas.cost", data });
    if (error) throw new Error("CHECKPOINT_DELTA_COST_UNAVAILABLE");
    return Object.freeze((data ?? []).map(row => Object.freeze({
      fromRevision: Number(row.from_revision), toRevision: Number(row.to_revision),
      baseHash: String(row.base_hash), targetHash: String(row.target_hash), provenanceHash: String(row.provenance_hash),
      deltaVersion: Number(row.delta_version), persistedRuntimeVersion: Number(row.persisted_runtime_version),
      payloadBytes: Number(row.payload_bytes),
    })));
  }
  async loadDeltas(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDelta[]> {
    const { data, error } = await this.client.from("runtime_checkpoint_deltas")
      .select("delta_payload")
      .eq("exercise_id", exerciseId).gte("to_revision", fromRevision + 1).lte("to_revision", toRevision)
      .order("to_revision", { ascending: true }).limit(limit);
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoint_deltas.hydration", data });
    if (error) throw new Error("CHECKPOINT_DELTA_UNAVAILABLE");
    return Object.freeze((data ?? []).map(row => row.delta_payload as RuntimeCheckpointDelta));
  }
  async loadWriterLease(exerciseId: string): Promise<RuntimeWriterLease | undefined> {
    const { data, error } = await this.client.from("runtime_writer_leases")
      .select("lease_id,exercise_id,writer_instance_id,writer_user_id,expires_at,released_at")
      .eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_writer_leases.metadata", data });
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
    recordSupabaseTraffic({ operation: "RPC", endpoint: "acquire_runtime_writer", data });
    if (error) return { status: code(error.message) === "WRITER_AUTHORITY_HELD" ? "HELD_BY_OTHER_WRITER" : code(error.message) === "CHECKPOINT_REVISION_CONFLICT" ? "STALE_LOCAL_STATE" : "AUTHORITY_UNAVAILABLE", code: code(error.message) as never };
    const row = Array.isArray(data) ? data[0] : data;
    return { status: row.already_owned ? "ALREADY_OWNED" : "ACQUIRED", checkpointRevision: Number(row.checkpoint_revision), lease: Object.freeze({ leaseId: row.lease_id, exerciseId, writerInstanceId, userId: row.user_id, expiresAt: row.expires_at }) };
  }
  async renewWriter(lease: RuntimeWriterLease, leaseSec: number): Promise<WriterAcquisitionResult> {
    const { data, error } = await this.client.rpc("renew_runtime_writer", { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId, p_lease_seconds: leaseSec });
    recordSupabaseTraffic({ operation: "RPC", endpoint: "renew_runtime_writer", data });
    if (error) return { status: "AUTHORITY_UNAVAILABLE", code: code(error.message) as never };
    const row = Array.isArray(data) ? data[0] : data;
    return { status: "ALREADY_OWNED", checkpointRevision: Number(row.checkpoint_revision), lease: Object.freeze({ ...lease, expiresAt: row.expires_at }) };
  }
  async releaseWriter(lease: RuntimeWriterLease): Promise<void> {
    const { error } = await this.client.rpc("release_runtime_writer", { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId });
    recordSupabaseTraffic({ operation: "RPC", endpoint: "release_runtime_writer" });
    if (error) throw new Error(code(error.message));
  }
  async publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>> {
    const delta = baseCheckpoint?.checkpointRevision === expectedRevision ? createRuntimeCheckpointDelta(baseCheckpoint, checkpoint) : undefined;
    let rpcName = delta && deltaRpcAvailable !== false ? "publish_runtime_checkpoint_delta" : "publish_runtime_checkpoint_metadata";
    let rpcArgs = { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId, p_expected_revision: expectedRevision, p_checkpoint: checkpoint, ...(delta && rpcName === "publish_runtime_checkpoint_delta" ? { p_delta: delta } : {}) };
    let response = await this.client.rpc(rpcName, rpcArgs);
    if (response.error && rpcName === "publish_runtime_checkpoint_delta" && (response.error.code === "PGRST202" || response.error.message.includes("publish_runtime_checkpoint_delta"))) {
      deltaRpcAvailable = false;
      rpcName = "publish_runtime_checkpoint_metadata";
      rpcArgs = { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId, p_expected_revision: expectedRevision, p_checkpoint: checkpoint };
      response = await this.client.rpc(rpcName, rpcArgs);
    } else if (!response.error && rpcName === "publish_runtime_checkpoint_delta") deltaRpcAvailable = true;
    const { data, error } = response;
    recordSupabaseTraffic({ operation: "RPC", endpoint: rpcName, data, requestBytes: estimateSupabasePayloadBytes(rpcArgs) });
    if (error) {
      const diagnostic = code(error.message);
      return { status: diagnostic === "STALE_WRITER" ? "STALE_CHECKPOINT_WRITER" : diagnostic === "CHECKPOINT_REVISION_CONFLICT" ? "REVISION_CONFLICT" : "AUTHORITY_UNAVAILABLE", code: diagnostic as never };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { status: "PUBLISHED", checkpoint: Object.freeze({
      ...checkpoint,
      checkpointRevision: Number(row.checkpoint_revision),
      payloadHash: row.payload_hash,
      provenanceHash: row.provenance_hash,
    }) };
  }
}

let deltaRpcAvailable: boolean | undefined;
