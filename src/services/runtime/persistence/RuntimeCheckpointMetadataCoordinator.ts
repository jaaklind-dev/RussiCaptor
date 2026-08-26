import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

export type RuntimeCheckpointMetadata = Readonly<{
  exerciseId: string;
  checkpointRevision: number;
  payloadHash: string;
  provenanceHash: string;
  writerInstanceId: string;
  updatedAt?: string;
}>;

type Checkpoint = RuntimeCheckpointEnvelope<SharedExerciseState>;
type CoordinatorOptions = Readonly<{
  exerciseId: string;
  current: () => Checkpoint | undefined;
  loadLatest: () => Promise<Checkpoint | undefined>;
  accept: (checkpoint: Checkpoint, metadata: RuntimeCheckpointMetadata) => Promise<void> | void;
  ignored?: (reason: "CURRENT" | "MALFORMED") => void;
  coalesced?: () => void;
}>;

export function parseRuntimeCheckpointMetadata(value: unknown): RuntimeCheckpointMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const exerciseId = row.exercise_id ?? row.exerciseId;
  const revision = Number(row.checkpoint_revision ?? row.checkpointRevision);
  const payloadHash = row.payload_hash ?? row.payloadHash;
  const provenanceHash = row.provenance_hash ?? row.provenanceHash;
  const writerInstanceId = row.writer_instance_id ?? row.writerInstanceId;
  const updatedAt = row.updated_at ?? row.updatedAt;
  if (typeof exerciseId !== "string" || !exerciseId || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof payloadHash !== "string" || !payloadHash || typeof provenanceHash !== "string" || !provenanceHash ||
      typeof writerInstanceId !== "string" || !writerInstanceId) return undefined;
  return Object.freeze({
    exerciseId,
    checkpointRevision: revision,
    payloadHash,
    provenanceHash,
    writerInstanceId,
    ...(typeof updatedAt === "string" ? { updatedAt } : {}),
  });
}

function covers(checkpoint: Checkpoint | undefined, metadata: RuntimeCheckpointMetadata): boolean {
  return checkpoint?.exerciseId === metadata.exerciseId &&
    (checkpoint.checkpointRevision > metadata.checkpointRevision ||
      (checkpoint.checkpointRevision === metadata.checkpointRevision && checkpoint.payloadHash === metadata.payloadHash));
}

function later(
  current: RuntimeCheckpointMetadata | undefined,
  incoming: RuntimeCheckpointMetadata,
): RuntimeCheckpointMetadata {
  if (!current || incoming.checkpointRevision > current.checkpointRevision) return incoming;
  if (incoming.checkpointRevision === current.checkpointRevision && incoming.payloadHash !== current.payloadHash) return incoming;
  return current;
}

/** Serializes conditional full-payload reads and always converges to the newest advertised revision. */
export class RuntimeCheckpointMetadataCoordinator {
  private desired: RuntimeCheckpointMetadata | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly options: CoordinatorOptions) {}

  notify(metadata: RuntimeCheckpointMetadata | undefined): Promise<void> {
    if (!metadata || metadata.exerciseId !== this.options.exerciseId) {
      this.options.ignored?.("MALFORMED");
      return Promise.resolve();
    }
    if (covers(this.options.current(), metadata)) {
      this.options.ignored?.("CURRENT");
      return this.inFlight ?? Promise.resolve();
    }
    const selected = later(this.desired, metadata);
    if (this.inFlight && selected === this.desired) this.options.coalesced?.();
    else if (this.inFlight) this.options.coalesced?.();
    this.desired = selected;
    if (!this.inFlight) this.inFlight = this.drain().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    let lagRetries = 0;
    while (this.desired) {
      const requested = this.desired;
      this.desired = undefined;
      const checkpoint = await this.options.loadLatest();
      if (checkpoint) await this.options.accept(checkpoint, requested);
      if (checkpoint && checkpoint.checkpointRevision < requested.checkpointRevision && lagRetries < 1) {
        this.desired = later(this.desired, requested);
        lagRetries += 1;
      } else lagRetries = 0;
      if (this.desired && covers(checkpoint, this.desired)) this.desired = undefined;
    }
  }
}
