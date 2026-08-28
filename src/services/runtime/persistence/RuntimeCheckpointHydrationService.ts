import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import { isValidRuntimeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { applyRuntimeCheckpointDeltaChain, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN } from "@/services/runtime/persistence/RuntimeCheckpointDeltaService";
import type { RuntimeCheckpointMetadata } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import type { RuntimeCheckpointDeltaMetadata, RuntimeCheckpointRepository } from "@/services/runtime/persistence/RuntimeCheckpointRepository";

type Checkpoint = RuntimeCheckpointEnvelope<SharedExerciseState>;
type HydrationRepository = Pick<RuntimeCheckpointRepository, "loadLatest" | "loadLatestMetadata" | "loadDeltaMetadata" | "loadDeltas">;

export type RuntimeCheckpointHydrationPurpose = "startup" | "realtime" | "takeover" | "recovery";
export const RUNTIME_CHECKPOINT_DELTA_COST_RATIO = 0.8;
export const RUNTIME_CHECKPOINT_DELTA_ABSOLUTE_CEILING_BYTES = 4 * 1024 * 1024;

function metric(operation: string, endpoint: string, data?: unknown, estimatedBytesSaved?: number): void {
  recordSupabaseTraffic({ operation, endpoint, data, estimatedBytesSaved });
}

const serializedBytes = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return 0; }
};

function validCostChain(base: Checkpoint, target: RuntimeCheckpointMetadata, rows: readonly RuntimeCheckpointDeltaMetadata[]): boolean {
  if (!rows.length || rows.length > MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN) return false;
  let revision = base.checkpointRevision;
  let hash = base.payloadHash;
  for (const row of rows) {
    if (row.deltaVersion !== 1 || row.persistedRuntimeVersion !== base.persistedRuntimeVersion || row.fromRevision !== revision ||
        row.baseHash !== hash || row.toRevision <= row.fromRevision || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes <= 0) return false;
    revision = row.toRevision;
    hash = row.targetHash;
  }
  const last = rows.at(-1)!;
  return revision === target.checkpointRevision && hash === target.payloadHash && last.provenanceHash === target.provenanceHash;
}

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
      if (!metadata.checkpointBytes) {
        metric("DELTA_COST_LEGACY_FALLBACK", `runtime_checkpoints.${purpose}.missing_full_size`);
        return repository.loadLatest(exerciseId, `runtime_checkpoints.${purpose}_cost_fallback_payload`);
      }
      const candidate = await repository.loadDeltaMetadata(exerciseId, validLocal.checkpointRevision, metadata.checkpointRevision, MAX_RUNTIME_CHECKPOINT_DELTA_CHAIN + 1);
      const candidateBytes = candidate.reduce((sum, row) => sum + (Number.isSafeInteger(row.payloadBytes) ? row.payloadBytes : 0), 0);
      metric("DELTA_CHAIN_CANDIDATE", `runtime_checkpoints.${purpose}`, { count: candidate.length, candidateBytes, checkpointBytes: metadata.checkpointBytes });
      if (!validCostChain(validLocal, metadata, candidate)) {
        metric("DELTA_COST_LEGACY_FALLBACK", `runtime_checkpoints.${purpose}.missing_or_invalid_cost`);
        return repository.loadLatest(exerciseId, `runtime_checkpoints.${purpose}_cost_fallback_payload`);
      }
      const ratioBudget = Math.floor(metadata.checkpointBytes * RUNTIME_CHECKPOINT_DELTA_COST_RATIO);
      if (candidateBytes > RUNTIME_CHECKPOINT_DELTA_ABSOLUTE_CEILING_BYTES || candidateBytes > ratioBudget) {
        metric("FULL_SELECTED_BY_COST", `runtime_checkpoints.${purpose}`, { candidateBytes, checkpointBytes: metadata.checkpointBytes }, Math.max(0, candidateBytes - metadata.checkpointBytes));
        if (candidateBytes >= metadata.checkpointBytes) metric("DELTA_WOULD_EXCEED_FULL", `runtime_checkpoints.${purpose}`, { candidateBytes, checkpointBytes: metadata.checkpointBytes });
        return repository.loadLatest(exerciseId, `runtime_checkpoints.${purpose}_cost_fallback_payload`);
      }
      metric("DELTA_SELECTED", `runtime_checkpoints.${purpose}`, { candidateBytes, checkpointBytes: metadata.checkpointBytes }, Math.max(0, metadata.checkpointBytes - candidateBytes));
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
