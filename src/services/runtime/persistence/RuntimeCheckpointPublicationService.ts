import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { loadCheckpointFreshness, type RuntimeCheckpointFreshness, type RuntimeCheckpointPublicationControl, type RuntimeCheckpointRepository } from "./RuntimeCheckpointRepository";
import { RuntimeCheckpointDeltaBuildCancelledError } from "./RuntimeCheckpointDeltaService";
import { traceRuntimeLeaseLifecycle } from "./RuntimeLeaseLifecycleTrace";

export type RuntimeCheckpointPublicationTerminal = Readonly<
  | { state: "PUBLISHED"; checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>; reconciled: boolean }
  | { state: "RECONCILED_FORWARD"; checkpointRevision: number; payloadHash: string; provenanceHash: string; code: "CHECKPOINT_PUBLICATION_RECONCILED_FORWARD" }
  | { state: "STALE_WRITER" | "REVISION_CONFLICT" | "BACKEND_ERROR" | "TRANSPORT_TIMEOUT" | "AUTH_UNAVAILABLE" | "GENERATION_STOPPED"; code: string }
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

/** A CAS conflict can be the delayed observation of this writer's own earlier,
 * successfully committed publication.  Only server metadata cryptographically
 * bound to the same installation writer lineage may advance the local CAS
 * cursor; an equal revision additionally has to identify the exact payload. */
export function reconcileRuntimeCheckpointPublication(
  remote: RuntimeCheckpointFreshness | undefined,
  lease: RuntimeWriterLease,
  expectedRevision: number,
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
): RuntimeCheckpointPublicationTerminal {
  if (checkpoint.exerciseId !== lease.exerciseId || remote?.exerciseId !== checkpoint.exerciseId) {
    return { state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" };
  }
  if (!remote || remote.checkpointRevision <= expectedRevision) {
    return { state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_PUBLICATION_UNCERTAIN" };
  }
  const sameWriter = remote.writerInstanceId === lease.writerInstanceId;
  if (remote.checkpointRevision === checkpoint.checkpointRevision) {
    if (sameWriter && remote.payloadHash === checkpoint.payloadHash &&
      remote.provenanceHash === checkpoint.provenanceHash) {
      return { state: "PUBLISHED", checkpoint, reconciled: true };
    }
    return { state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" };
  }
  if (sameWriter) {
    return { state: "RECONCILED_FORWARD", checkpointRevision: remote.checkpointRevision,
      payloadHash: remote.payloadHash, provenanceHash: remote.provenanceHash,
      code: "CHECKPOINT_PUBLICATION_RECONCILED_FORWARD" };
  }
  return { state: "REVISION_CONFLICT", code: "CHECKPOINT_REVISION_CONFLICT" };
}

export async function publishRuntimeCheckpointTerminal(
  repository: Pick<RuntimeCheckpointRepository, "publish" | "loadLatest" | "loadLatestMetadata">,
  lease: RuntimeWriterLease,
  expectedRevision: number,
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>,
  control?: RuntimeCheckpointPublicationControl,
): Promise<RuntimeCheckpointPublicationTerminal> {
  let rpc: Awaited<ReturnType<typeof bounded<Awaited<ReturnType<RuntimeCheckpointRepository["publish"]>>>>>;
  try {
    if (control) {
      let markSubmitted!: () => void;
      const submitted = new Promise<void>(resolve => { markSubmitted = resolve; });
      let settled = false;
      const publish = repository.publish(lease, expectedRevision, checkpoint, baseCheckpoint, {
        ...control,
        onRpcSubmitted: () => {
          control.onRpcSubmitted?.();
          markSubmitted();
        },
      }).then(value => {
        settled = true;
        return value;
      });
      // Local cooperative preparation is allowed to take longer than the RPC
      // transport deadline. Start the transport clock only once the request is
      // irreversibly submitted; before that the generation guard can cancel it.
      await Promise.race([submitted, publish.then(() => undefined)]);
      rpc = settled ? { ok: true, value: await publish } : await bounded(publish, timeoutMs);
    } else {
      rpc = await bounded(repository.publish(lease, expectedRevision, checkpoint, baseCheckpoint), timeoutMs);
    }
  } catch (error) {
    if (error instanceof RuntimeCheckpointDeltaBuildCancelledError || error instanceof Error && error.message === "GENERATION_STOPPED") {
      return { state: "GENERATION_STOPPED", code: "GENERATION_STOPPED" };
    }
    throw error;
  }
  let directConflict: RuntimeCheckpointPublicationTerminal | undefined;
  if (rpc.ok) {
    if (rpc.value.status === "PUBLISHED") return { state: "PUBLISHED", checkpoint: rpc.value.checkpoint, reconciled: false };
    directConflict = failure(rpc.value.code);
    if (directConflict.state !== "REVISION_CONFLICT") return directConflict;
  }

  traceRuntimeLeaseLifecycle("PUBLICATION_RECONCILE_START", {
    detail: {
      checkpointRevision: checkpoint.checkpointRevision,
      expectedRevision,
      trigger: directConflict ? "REVISION_CONFLICT" : "TRANSPORT_TIMEOUT",
    },
  });
  const lookup = await bounded(loadCheckpointFreshness(repository, checkpoint.exerciseId, "cas"), timeoutMs);
  if (!lookup.ok) {
    traceRuntimeLeaseLifecycle("PUBLICATION_RECONCILE_UNRESOLVED", {
      detail: { checkpointRevision: checkpoint.checkpointRevision, reason: "LOOKUP_TIMEOUT" },
    });
    return directConflict ?? { state: "TRANSPORT_TIMEOUT", code: "CHECKPOINT_RECONCILIATION_TIMEOUT" };
  }
  const reconciled = reconcileRuntimeCheckpointPublication(lookup.value, lease, expectedRevision, checkpoint);
  traceRuntimeLeaseLifecycle(
    reconciled.state === "PUBLISHED" && reconciled.reconciled
      ? "PUBLICATION_RECONCILE_COMMITTED_MATCH"
      : reconciled.state === "RECONCILED_FORWARD"
        ? "PUBLICATION_RECONCILE_FORWARD"
        : "PUBLICATION_RECONCILE_UNRESOLVED",
    { detail: { checkpointRevision: checkpoint.checkpointRevision, remoteRevision: lookup.value?.checkpointRevision } },
  );
  return directConflict && reconciled.state === "TRANSPORT_TIMEOUT" ? directConflict : reconciled;
}
