import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CheckpointPublishResult,
  RuntimeCheckpointEnvelope,
  RuntimeCheckpointCanonicalRepresentation,
  RuntimeWriterLease,
  WriterAcquisitionResult,
} from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { estimateSupabasePayloadBytes, isSupabaseTrafficMetricsEnabled, recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { parseRuntimeCheckpointMetadata, type RuntimeCheckpointMetadata } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import {
  createRuntimeCheckpointDeltaAsync,
  RuntimeCheckpointDeltaBuildCancelledError,
  type RuntimeCheckpointDelta,
} from "@/services/runtime/persistence/RuntimeCheckpointDeltaService";
import { startRuntimeWorkTrace, traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import {
  getRuntimeCheckpointCanonicalRepresentation,
  restoreRuntimeCheckpointCanonicalRepresentation,
} from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";

export type RuntimeCheckpointPublicationControl = Readonly<{
  priority: "ROUTINE" | "LIFECYCLE_CRITICAL";
  yieldControl: PipelineYield;
  shouldContinue: () => boolean;
  onRpcSubmitted?: () => void;
}>;

export interface RuntimeCheckpointRepository {
  loadLatest(exerciseId: string, trafficEndpoint?: string): Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined>;
  loadLatestMetadata(exerciseId: string, trafficEndpoint?: string): Promise<RuntimeCheckpointMetadata | undefined>;
  loadDeltas(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDelta[]>;
  loadDeltaMetadata(exerciseId: string, fromRevision: number, toRevision: number, limit: number): Promise<readonly RuntimeCheckpointDeltaMetadata[]>;
  acquireWriter(exerciseId: string, writerInstanceId: string, expectedRevision: number, leaseSec: number): Promise<WriterAcquisitionResult>;
  renewWriter(lease: RuntimeWriterLease, leaseSec: number): Promise<WriterAcquisitionResult>;
  releaseWriter(lease: RuntimeWriterLease): Promise<void>;
  publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>, control?: RuntimeCheckpointPublicationControl): Promise<CheckpointPublishResult<SharedExerciseState>>;
  finalizeCompletion?(completionCommandId: string, lease: RuntimeWriterLease, expectedRevision: number,
    checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>>;
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

function terminalPublicationDiagnostic(error: Readonly<{ code?: string; message: string }>): string {
  const known = ["STALE_WRITER", "CHECKPOINT_REVISION_CONFLICT", "TERMINAL_CHECKPOINT_INVALID"]
    .find(item => error.message.includes(item));
  if (known) return known;
  if (error.code === "PGRST301" || /\b(jwt|not authenticated|authentication required)\b/i.test(error.message)) {
    return "AUTHORITY_UNAVAILABLE";
  }
  return "BACKEND_ERROR";
}

function canonicalPayloadRpcArgs(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  canonical: RuntimeCheckpointCanonicalRepresentation,
): Readonly<Record<string, unknown>> {
  return {
    p_exercise_id: checkpoint.exerciseId,
    p_checkpoint_revision: checkpoint.checkpointRevision,
    p_persisted_runtime_version: checkpoint.persistedRuntimeVersion,
    p_payload_hash: checkpoint.payloadHash,
    p_provenance_hash: checkpoint.provenanceHash,
    p_canonical_format_version: canonical.canonicalFormatVersion,
    p_canonical_payload_text: canonical.canonicalPayloadText,
  };
}

function rpcUnavailable(error: Readonly<{ code?: string; message: string }> | null, rpcName: string): boolean {
  return Boolean(error && (error.code === "PGRST202" || error.message.includes(rpcName)));
}

export class SupabaseRuntimeCheckpointRepository implements RuntimeCheckpointRepository {
  constructor(private readonly client: SupabaseClient) {}
  async loadLatest(exerciseId: string, trafficEndpoint = "runtime_checkpoints.payload") {
    const endFetch = startRuntimeWorkTrace("STARTUP_CHECKPOINT_FETCH", { endpoint: trafficEndpoint });
    const canonical = await this.client.from("runtime_checkpoint_canonical_artifacts")
      .select("canonical_format_version,exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,canonical_payload_text,derivation_method")
      .eq("exercise_id", exerciseId).maybeSingle();
    if (!canonical.error && canonical.data?.canonical_payload_text) {
      const row = canonical.data;
      recordSupabaseTraffic({ operation: "SELECT", endpoint: `${trafficEndpoint}.canonical`, data: row, fullSnapshot: true });
      const representation: RuntimeCheckpointCanonicalRepresentation = Object.freeze({
        canonicalFormatVersion: Number(row.canonical_format_version) as 1,
        exerciseId: String(row.exercise_id),
        checkpointRevision: Number(row.checkpoint_revision),
        persistedRuntimeVersion: Number(row.persisted_runtime_version),
        payloadHash: String(row.payload_hash),
        provenanceHash: String(row.provenance_hash),
        canonicalPayloadText: String(row.canonical_payload_text),
        derivationMethod: row.derivation_method === "LEGACY_DERIVATION" ? "LEGACY_DERIVATION" : "WRITER",
      });
      const checkpoint = await restoreRuntimeCheckpointCanonicalRepresentation(
        representation,
        () => new Promise(resolve => setTimeout(resolve, 0)),
      );
      endFetch({ payloadBytes: estimateSupabasePayloadBytes(row), representation: "CANONICAL_V1" });
      return checkpoint;
    }
    if (canonical.error && !["42P01", "PGRST205"].includes(canonical.error.code ?? "") &&
      !canonical.error.message.includes("runtime_checkpoint_canonical_artifacts")) {
      throw new Error("AUTHORITY_UNAVAILABLE");
    }
    const { data, error } = await this.client.from("runtime_checkpoints").select("payload")
      .eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: trafficEndpoint, data, fullSnapshot: true });
    endFetch({ payloadBytes: estimateSupabasePayloadBytes(data) });
    if (error) throw new Error("AUTHORITY_UNAVAILABLE");
    return data?.payload as RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  }
  async loadLatestMetadata(exerciseId: string, trafficEndpoint = "runtime_checkpoint_notifications.metadata"): Promise<RuntimeCheckpointMetadata | undefined> {
    const endMetadata = startRuntimeWorkTrace("STARTUP_CHECKPOINT_METADATA", { endpoint: trafficEndpoint });
    const { data, error } = await this.client.from("runtime_checkpoint_notifications")
      .select("exercise_id,checkpoint_revision,payload_hash,provenance_hash,writer_instance_id,updated_at,checkpoint_bytes")
      .eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: trafficEndpoint, data });
    endMetadata({ responseBytes: estimateSupabasePayloadBytes(data) });
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
  async finalizeCompletion(completionCommandId: string, lease: RuntimeWriterLease, expectedRevision: number,
    checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): Promise<CheckpointPublishResult<SharedExerciseState>> {
    const canonical = getRuntimeCheckpointCanonicalRepresentation(checkpoint);
    let rpcName = canonical ? "finalize_runtime_completion_canonical_payload" : "finalize_runtime_completion";
    let rpcArgs: Record<string, unknown> = {
      p_exercise_id: checkpoint.exerciseId, p_command_id: completionCommandId, p_lease_id: lease.leaseId,
      p_writer_instance_id: lease.writerInstanceId, p_expected_checkpoint_revision: expectedRevision,
      ...(canonical ? canonicalPayloadRpcArgs(checkpoint, canonical) : { p_checkpoint: checkpoint }),
    };
    let response = await this.client.rpc(rpcName, rpcArgs);
    if (canonical && rpcUnavailable(response.error, rpcName)) {
      rpcName = "finalize_runtime_completion_canonical";
      rpcArgs = {
        p_exercise_id: checkpoint.exerciseId, p_command_id: completionCommandId, p_lease_id: lease.leaseId,
        p_writer_instance_id: lease.writerInstanceId, p_expected_checkpoint_revision: expectedRevision,
        p_checkpoint: checkpoint, p_canonical_format_version: canonical.canonicalFormatVersion,
        p_canonical_payload_text: canonical.canonicalPayloadText,
      };
      response = await this.client.rpc(rpcName, rpcArgs);
    }
    const { data, error } = response;
    recordSupabaseTraffic({ operation: "RPC", endpoint: rpcName, data,
      requestBytes: isSupabaseTrafficMetricsEnabled() ? estimateSupabasePayloadBytes(rpcArgs) : 0 });
    if (error) {
      const diagnostic = terminalPublicationDiagnostic(error);
      traceRuntimeLeaseLifecycle("TERMINAL_PUBLICATION_RPC_FAILED", {
        detail: { databaseCode: error.code ?? "UNAVAILABLE", diagnostic },
      });
      return { status: diagnostic === "STALE_WRITER" ? "STALE_CHECKPOINT_WRITER"
        : diagnostic === "CHECKPOINT_REVISION_CONFLICT" ? "REVISION_CONFLICT" : "AUTHORITY_UNAVAILABLE", code: diagnostic as never };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { status: "PUBLISHED", checkpoint: Object.freeze({ ...checkpoint,
      checkpointRevision: Number(row.checkpoint_revision), payloadHash: String(row.payload_hash),
      provenanceHash: String(row.provenance_hash) }) };
  }
  async publish(lease: RuntimeWriterLease, expectedRevision: number, checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>, control?: RuntimeCheckpointPublicationControl): Promise<CheckpointPublishResult<SharedExerciseState>> {
    const endRequestObject = startRuntimeWorkTrace("REMOTE_PUB_REQUEST_OBJECT", { checkpointRevision: checkpoint.checkpointRevision });
    const ensureActive = (): void => {
      if (control?.shouldContinue() === false) throw new RuntimeCheckpointDeltaBuildCancelledError();
    };
    ensureActive();
    const delta = baseCheckpoint?.checkpointRevision === expectedRevision
      ? await createRuntimeCheckpointDeltaAsync(baseCheckpoint, checkpoint, {
          yieldControl: control?.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))),
          shouldContinue: control?.shouldContinue,
        })
      : undefined;
    ensureActive();
    const canonical = getRuntimeCheckpointCanonicalRepresentation(checkpoint);
    let rpcName = canonical
      ? delta && deltaRpcAvailable !== false ? "publish_runtime_checkpoint_canonical_payload_delta" : "publish_runtime_checkpoint_canonical_payload"
      : delta && deltaRpcAvailable !== false ? "publish_runtime_checkpoint_delta" : "publish_runtime_checkpoint_metadata";
    let rpcArgs: Record<string, unknown> = { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId,
      p_expected_revision: expectedRevision,
      ...(canonical ? canonicalPayloadRpcArgs(checkpoint, canonical) : { p_checkpoint: checkpoint }),
      ...(delta && rpcName.includes("delta") ? { p_delta: delta } : {}) };
    endRequestObject({ rpcName, deltaOperationCount: delta?.operations.length ?? 0, priority: control?.priority,
      structuredPayloadTransported: canonical ? false : true,
      canonicalPayloadCharacters: canonical?.canonicalPayloadText.length ?? 0 });
    ensureActive();
    const endSupabaseCall = startRuntimeWorkTrace("REMOTE_PUB_SUPABASE_CALL", { rpcName });
    control?.onRpcSubmitted?.();
    let response = await this.client.rpc(rpcName, rpcArgs);
    endSupabaseCall({ rpcName, errorPresent: Boolean(response.error) });
    if (response.error && rpcName.includes("delta") && rpcUnavailable(response.error, rpcName)) {
      deltaRpcAvailable = false;
      rpcName = canonical ? "publish_runtime_checkpoint_canonical_payload" : "publish_runtime_checkpoint_metadata";
      rpcArgs = { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId,
        p_expected_revision: expectedRevision,
        ...(canonical ? canonicalPayloadRpcArgs(checkpoint, canonical) : { p_checkpoint: checkpoint }) };
      const endFallbackCall = startRuntimeWorkTrace("REMOTE_PUB_SUPABASE_CALL", { rpcName, fallback: true });
      control?.onRpcSubmitted?.();
      response = await this.client.rpc(rpcName, rpcArgs);
      endFallbackCall({ rpcName, fallback: true, errorPresent: Boolean(response.error) });
    } else if (!response.error && rpcName.includes("delta")) deltaRpcAvailable = true;
    if (response.error && canonical && rpcName === "publish_runtime_checkpoint_canonical_payload" &&
      rpcUnavailable(response.error, rpcName)) {
      rpcName = "publish_runtime_checkpoint_canonical";
      rpcArgs = { p_lease_id: lease.leaseId, p_writer_instance_id: lease.writerInstanceId,
        p_expected_revision: expectedRevision, p_checkpoint: checkpoint,
        p_canonical_format_version: canonical.canonicalFormatVersion,
        p_canonical_payload_text: canonical.canonicalPayloadText };
      response = await this.client.rpc(rpcName, rpcArgs);
    }
    const endResponseProcess = startRuntimeWorkTrace("REMOTE_PUB_RESPONSE_PROCESS", { rpcName });
    const { data, error } = response;
    const endTrafficMeasurement = startRuntimeWorkTrace("REMOTE_PUB_REQUEST_SERIALIZE", { rpcName, measurementOnly: true });
    // Egress instrumentation must not synchronously serialize a second copy of
    // a multi-megabyte request when metrics are disabled in production.
    const requestBytes = isSupabaseTrafficMetricsEnabled() ? estimateSupabasePayloadBytes(rpcArgs) : 0;
    endTrafficMeasurement({ rpcName, requestBytes, measured: isSupabaseTrafficMetricsEnabled() });
    recordSupabaseTraffic({ operation: "RPC", endpoint: rpcName, data, requestBytes });
    endResponseProcess({ rpcName, errorPresent: Boolean(error), responseRows: Array.isArray(data) ? data.length : data == null ? 0 : 1 });
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
