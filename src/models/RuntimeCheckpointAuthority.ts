export const RUNTIME_CHECKPOINT_ENVELOPE_VERSION = 1 as const;

export type RuntimeCheckpointEnvelope<TPayload = unknown> = Readonly<{
  envelopeVersion: typeof RUNTIME_CHECKPOINT_ENVELOPE_VERSION;
  exerciseId: string;
  checkpointRevision: number;
  persistedRuntimeVersion: number;
  payload: TPayload;
  payloadHash: string;
  provenanceHash: string;
}>;

export type RuntimeWriterLease = Readonly<{
  leaseId: string;
  exerciseId: string;
  writerInstanceId: string;
  userId: string;
  expiresAt: string;
}>;

export type CheckpointAuthorityDiagnosticCode =
  | "CHECKPOINT_NOT_FOUND"
  | "CHECKPOINT_STALE"
  | "CHECKPOINT_REVISION_CONFLICT"
  | "CHECKPOINT_REVISION_DIVERGENCE"
  | "CHECKPOINT_HASH_INVALID"
  | "CHECKPOINT_PROVENANCE_INVALID"
  | "WRITER_AUTHORITY_HELD"
  | "WRITER_LEASE_EXPIRED"
  | "WRITER_AUTHORITY_UNAVAILABLE"
  | "STALE_WRITER"
  | "TAKEOVER_DENIED"
  | "TAKEOVER_FAILED"
  | "REMOTE_SYNC_CONFLICT";

export type CheckpointResolution<TPayload = unknown> = Readonly<
  | { status: "NONE" }
  | { status: "LOCAL" | "REMOTE" | "EQUIVALENT"; checkpoint: RuntimeCheckpointEnvelope<TPayload> }
  | { status: "CONFLICT"; code: CheckpointAuthorityDiagnosticCode }
>;

export type WriterAcquisitionResult = Readonly<
  | { status: "ACQUIRED" | "ALREADY_OWNED"; lease: RuntimeWriterLease; checkpointRevision: number }
  | { status: "HELD_BY_OTHER_WRITER" | "STALE_LOCAL_STATE" | "AUTHORITY_UNAVAILABLE"; code: CheckpointAuthorityDiagnosticCode; checkpointRevision?: number }
>;

export type CheckpointPublishResult<TPayload = unknown> = Readonly<
  | { status: "PUBLISHED"; checkpoint: RuntimeCheckpointEnvelope<TPayload> }
  | { status: "STALE_CHECKPOINT_WRITER" | "REVISION_CONFLICT" | "AUTHORITY_UNAVAILABLE"; code: CheckpointAuthorityDiagnosticCode; checkpointRevision?: number }
>;
