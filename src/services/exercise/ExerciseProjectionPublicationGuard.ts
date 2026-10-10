import type { RuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import type { RuntimeReaderConvergenceState } from "@/services/runtime/persistence/RuntimeReaderConvergenceService";

export type ProjectionPublicationContext = Readonly<{
  exerciseId: string;
  lifecycleState: string;
  selectedMode?: string;
  writerAuthority: RuntimeWriterAuthorityState;
  reader: RuntimeReaderConvergenceState;
  readerGeneration: number;
  runtimeGeneration: number;
  writerGeneration: number;
  writerLeaseId?: string;
  authGeneration: number;
  cloudGeneration: number;
  syncVersion: number;
  mutationGeneration: number;
  publishedMutationGeneration: number;
}>;

export type ProjectionPublicationStamp = Readonly<{
  exerciseId: string;
  lifecycleState: string;
  readerGeneration?: number;
  runtimeGeneration: number;
  writerGeneration?: number;
  writerLeaseId?: string;
  authGeneration: number;
  cloudGeneration: number;
  syncVersion: number;
  mutationGeneration: number;
}>;

/** Discovery and cache hydration are reads, not publication intents. */
export function captureProjectionPublicationStamp(context: ProjectionPublicationContext): ProjectionPublicationStamp | undefined {
  if (context.mutationGeneration <= context.publishedMutationGeneration) return undefined;
  const active = context.lifecycleState === "RUNNING" || context.lifecycleState === "PAUSED";
  if (active && (context.selectedMode !== "EXCON" || context.writerAuthority !== "WRITER" || !context.writerLeaseId ||
    context.reader.phase !== "WRITER" || context.reader.exerciseId !== context.exerciseId)) return undefined;
  return Object.freeze({
    exerciseId: context.exerciseId,
    lifecycleState: context.lifecycleState,
    ...(active ? { readerGeneration: context.readerGeneration } : {}),
    runtimeGeneration: context.runtimeGeneration,
    ...(active ? { writerGeneration: context.writerGeneration, writerLeaseId: context.writerLeaseId } : {}),
    authGeneration: context.authGeneration,
    cloudGeneration: context.cloudGeneration,
    syncVersion: context.syncVersion,
    mutationGeneration: context.mutationGeneration,
  });
}

/** The candidate may be queued before auth, mode, checkpoint or writer changes. */
export function projectionPublicationStampIsCurrent(
  stamp: ProjectionPublicationStamp,
  context: ProjectionPublicationContext,
): boolean {
  return projectionPublicationRejectionReason(stamp, context) === undefined;
}

export type ProjectionPublicationRejectionReason =
  | "EXERCISE_ID_MISMATCH" | "STALE_AUTH_GENERATION" | "STALE_RUNTIME_GENERATION"
  | "STALE_EXERCISE_BINDING" | "STALE_WRITER_GENERATION" | "WRITER_NOT_READY"
  | "NO_ACTIVE_WRITER" | "STALE_PUBLICATION_GENERATION" | "CANONICAL_REBASE_INVALIDATED";

export function projectionPublicationRejectionReason(
  stamp: ProjectionPublicationStamp,
  context: ProjectionPublicationContext,
): ProjectionPublicationRejectionReason | undefined {
  if (context.exerciseId !== stamp.exerciseId) return "EXERCISE_ID_MISMATCH";
  if (context.authGeneration !== stamp.authGeneration) return "STALE_AUTH_GENERATION";
  if (context.runtimeGeneration !== stamp.runtimeGeneration) return "STALE_RUNTIME_GENERATION";
  if (context.cloudGeneration !== stamp.cloudGeneration) return "STALE_RUNTIME_GENERATION";
  if (context.readerGeneration !== stamp.readerGeneration && stamp.readerGeneration !== undefined) return "STALE_EXERCISE_BINDING";
  if (stamp.writerGeneration !== undefined &&
    (context.writerGeneration !== stamp.writerGeneration || context.writerLeaseId !== stamp.writerLeaseId)) return "STALE_WRITER_GENERATION";
  if (stamp.writerGeneration !== undefined && context.writerAuthority !== "WRITER") return "NO_ACTIVE_WRITER";
  if (stamp.writerGeneration !== undefined &&
    (context.selectedMode !== "EXCON" || context.reader.phase !== "WRITER" || context.reader.exerciseId !== stamp.exerciseId)) return "WRITER_NOT_READY";
  if (context.syncVersion !== stamp.syncVersion || context.lifecycleState !== stamp.lifecycleState) return "CANONICAL_REBASE_INVALIDATED";
  if (context.mutationGeneration !== stamp.mutationGeneration ||
    context.mutationGeneration <= context.publishedMutationGeneration) return "STALE_PUBLICATION_GENERATION";
  const current = captureProjectionPublicationStamp(context);
  if (!current || !(current.exerciseId === stamp.exerciseId &&
    current.lifecycleState === stamp.lifecycleState &&
    current.readerGeneration === stamp.readerGeneration &&
    current.runtimeGeneration === stamp.runtimeGeneration &&
    current.writerGeneration === stamp.writerGeneration &&
    current.writerLeaseId === stamp.writerLeaseId &&
    current.authGeneration === stamp.authGeneration &&
    current.cloudGeneration === stamp.cloudGeneration &&
    current.syncVersion === stamp.syncVersion &&
    current.mutationGeneration === stamp.mutationGeneration)) return "WRITER_NOT_READY";
  return undefined;
}

/** The callback must initiate the network mutation synchronously, with no await after this check. */
export function sendCurrentProjectionPublication<T>(
  stamp: ProjectionPublicationStamp,
  context: ProjectionPublicationContext,
  send: () => T,
): { outcome: "REJECTED"; reason: ProjectionPublicationRejectionReason } | { outcome: "SENT"; result: T } {
  const reason = projectionPublicationRejectionReason(stamp, context);
  return reason ? { outcome: "REJECTED", reason } : { outcome: "SENT", result: send() };
}

/** New local mutations may replace a queued payload, but not its authority. */
export function sameProjectionPublicationGeneration(
  queued: ProjectionPublicationStamp,
  current: ProjectionPublicationStamp,
): boolean {
  return queued.exerciseId === current.exerciseId &&
    queued.readerGeneration === current.readerGeneration &&
    queued.runtimeGeneration === current.runtimeGeneration &&
    queued.writerGeneration === current.writerGeneration &&
    queued.writerLeaseId === current.writerLeaseId &&
    queued.authGeneration === current.authGeneration &&
    queued.cloudGeneration === current.cloudGeneration;
}
