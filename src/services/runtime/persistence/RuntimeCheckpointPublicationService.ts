import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { loadCheckpointFreshness, type RuntimeCheckpointRepository } from "./RuntimeCheckpointRepository";

export type RuntimeCheckpointPublicationTerminal = Readonly<
  | { state: "PUBLISHED"; checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>; reconciled: boolean }
  | { state: "STALE_WRITER" | "REVISION_CONFLICT" | "BACKEND_ERROR" | "TRANSPORT_TIMEOUT" | "AUTH_UNAVAILABLE"; code: string }
>;

const DEFAULT_TIMEOUT_MS = 8_000;

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(value => ({ ok: true as const, value })),
      new Promise<{ ok: false }>(resolve => { timer = setTimeout(() => resolve({ ok: false }), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failure(code: string): RuntimeCheckpointPublicationTerminal {
  if (code === "STALE_WRITER") return { state: "STALE_WRITER", code };
  if (code === "CHECKPOINT_REVISION_CONFLICT") return { state: "REVISION_CONFLICT", code };
  if (code === "AUTHORITY_UNAVAILABLE") return { state: "AUTH_UNAVAILABLE", code };
  return { state: "BACKEND_ERROR", code };
}

export async function publishRuntimeCheckpointTerminal(
  repository: RuntimeCheckpointRepository,
  lease: RuntimeWriterLease,
  expectedRevision: number,
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>,
): Promise<RuntimeCheckpointPublicationTerminal> {
  const rpc = await bounded(repository.publish(lease, expectedRevision, checkpoint, baseCheckpoint), timeoutMs);
  if (rpc.ok) {
    if (rpc.value.status === "PUBLISHED") return { state: "PUBLISHED", checkpoint: rpc.value.checkpoint, reconciled: false };
    return failure(rpc.value.code);
  }

  const lookup = await bounded(loadCheckpointFreshness(repository, checkpoint.exerciseId, "cas"), timeoutMs);
  if (!lookup.ok) return { state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_RECONCILIATION_TIMEOUT" };
  const remote = lookup.value;
  if (remote?.checkpointRevision === checkpoint.checkpointRevision && remote.payloadHash === checkpoint.payloadHash) {
    return { state: "PUBLISHED", checkpoint, reconciled: true };
  }
  if (!remote || remote.checkpointRevision === expectedRevision) {
    return { state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_PUBLICATION_UNCERTAIN" };
  }
  return { state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" };
}
