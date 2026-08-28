import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { isValidRuntimeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { applyRuntimeCheckpointDeltaChain, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN } from "@/services/runtime/persistence/RuntimeCheckpointDeltaService";
import type { RuntimeCheckpointMetadata } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import type { RuntimeCheckpointRepository } from "@/services/runtime/persistence/RuntimeCheckpointRepository";

type Checkpoint = RuntimeCheckpointEnvelope<SharedExerciseState>;
type HydrationRepository = Pick<RuntimeCheckpointRepository, "loadLatest" | "loadLatestMetadata" | "loadDeltas">;

export type RuntimeCheckpointHydrationPurpose = "startup" | "realtime" | "takeover" | "recovery";

function metric(operation: string, endpoint: string, data?: unknown, estimatedBytesSaved?: number): void {
  recordSupabaseTraffic({ operation, endpoint, data, estimatedBytesSaved });
}

const serializedBytes = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return 0; }
};

/** Metadata validates the durable local checkpoint first. A bounded, verified
 * delta chain is attempted only for a valid older cache; every other case
 * falls back to the unchanged authoritative full checkpoint. */
export async function loadRuntimeCheckpointWithCache(
  repository: HydrationRepository,
  exerciseId: string,
  local: Checkpoint | undefined,
  purpose: RuntimeCheckpointHydrationPurpose,
  advertisedMetadata?: RuntimeCheckpointMetadata,
): Promise<Checkpoint | undefined> {
  let metadata = advertisedMetadata;
  if (!metadata) {
    try {
      metadata = await repository.loadLatestMetadata(exerciseId, `runtime_checkpoint_notifications.${purpose}_cache_metadata`);
      metric("CACHE_METADATA_CHECK", `runtime_checkpoints.${purpose}`);
    } catch {
      metric("CACHE_INVALIDATED", `runtime_checkpoints.${purpose}.metadata_unavailable`);
    }
  }
  const validLocal = local?.exerciseId === exerciseId && isValidRuntimeCheckpoint(local) ? local : undefined;
  if (local && !validLocal) metric("CACHE_INVALIDATED", `runtime_checkpoints.${purpose}.invalid_local`);
  if (metadata && validLocal && validLocal.checkpointRevision === metadata.checkpointRevision &&
      validLocal.payloadHash === metadata.payloadHash && validLocal.provenanceHash === metadata.provenanceHash) {
    metric("CACHE_HIT", `runtime_checkpoints.${purpose}`);
    metric("FULL_PAYLOAD_AVOIDED", `runtime_checkpoints.${purpose}.cache`, undefined, serializedBytes(validLocal));
    return validLocal;
  }
  metric("CACHE_MISS", `runtime_checkpoints.${purpose}`);
  if (metadata && validLocal && validLocal.checkpointRevision < metadata.checkpointRevision) {
    try {
      const deltas = await repository.loadDeltas(exerciseId, validLocal.checkpointRevision, metadata.checkpointRevision, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN + 1);
      metric("DELTA_CHAIN", `runtime_checkpoints.${purpose}`, { count: deltas.length });
      const reconstructed = applyRuntimeCheckpointDeltaChain(validLocal, deltas, metadata.checkpointRevision, metadata.payloadHash);
      if (reconstructed.provenanceHash !== metadata.provenanceHash) throw new Error("CHECKPOINT_DELTA_TARGET_INVALID");
      metric("DELTA_APPLIED", `runtime_checkpoints.${purpose}`, { count: deltas.length });
      metric("FULL_PAYLOAD_AVOIDED", `runtime_checkpoints.${purpose}.delta`, undefined,
        Math.max(0, serializedBytes(reconstructed) - serializedBytes(deltas)));
      return reconstructed;
    } catch (error) {
      const reason = error instanceof Error && error.message === "CHECKPOINT_DELTA_CHAIN_UNAVAILABLE" ? "chain_unavailable"
        : error instanceof Error && error.message === "CHECKPOINT_DELTA_BASE_INVALID" ? "base_invalid"
        : "verification_failed";
      metric("FULL_PAYLOAD_FALLBACK", `runtime_checkpoints.${purpose}.${reason}`);
    }
  } else if (metadata && validLocal && validLocal.checkpointRevision > metadata.checkpointRevision) {
    metric("FULL_PAYLOAD_FALLBACK", `runtime_checkpoints.${purpose}.remote_older`);
  } else if (!validLocal) metric("FULL_PAYLOAD_FALLBACK", `runtime_checkpoints.${purpose}.empty_cache`);
  else metric("FULL_PAYLOAD_FALLBACK", `runtime_checkpoints.${purpose}.divergent_cache`);
  return repository.loadLatest(exerciseId, `runtime_checkpoints.${purpose}_fallback_payload`);
}
