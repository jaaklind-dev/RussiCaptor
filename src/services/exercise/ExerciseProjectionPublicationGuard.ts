import type { RuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import type { RuntimeReaderConvergenceState } from "@/services/runtime/persistence/RuntimeReaderConvergenceService";

export type ProjectionPublicationContext = Readonly<{
  exerciseId: string;
  lifecycleState: string;
  selectedMode?: string;
  writerAuthority: RuntimeWriterAuthorityState;
  reader: RuntimeReaderConvergenceState;
  readerGeneration: number;
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
  authGeneration: number;
  cloudGeneration: number;
  syncVersion: number;
  mutationGeneration: number;
}>;

/** Discovery and cache hydration are reads, not publication intents. */
export function captureProjectionPublicationStamp(context: ProjectionPublicationContext): ProjectionPublicationStamp | undefined {
  if (context.mutationGeneration <= context.publishedMutationGeneration) return undefined;
  const active = context.lifecycleState === "RUNNING" || context.lifecycleState === "PAUSED";
  if (active && (context.selectedMode !== "EXCON" || context.writerAuthority !== "WRITER" ||
    context.reader.phase !== "WRITER" || context.reader.exerciseId !== context.exerciseId)) return undefined;
  return Object.freeze({
    exerciseId: context.exerciseId,
    lifecycleState: context.lifecycleState,
    ...(active ? { readerGeneration: context.readerGeneration } : {}),
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
  const current = captureProjectionPublicationStamp(context);
  return Boolean(current && current.exerciseId === stamp.exerciseId &&
    current.lifecycleState === stamp.lifecycleState &&
    current.readerGeneration === stamp.readerGeneration &&
    current.authGeneration === stamp.authGeneration &&
    current.cloudGeneration === stamp.cloudGeneration &&
    current.syncVersion === stamp.syncVersion &&
    current.mutationGeneration === stamp.mutationGeneration);
}

/** New local mutations may replace a queued payload, but not its authority. */
export function sameProjectionPublicationGeneration(
  queued: ProjectionPublicationStamp,
  current: ProjectionPublicationStamp,
): boolean {
  return queued.exerciseId === current.exerciseId &&
    queued.readerGeneration === current.readerGeneration &&
    queued.authGeneration === current.authGeneration &&
    queued.cloudGeneration === current.cloudGeneration;
}
