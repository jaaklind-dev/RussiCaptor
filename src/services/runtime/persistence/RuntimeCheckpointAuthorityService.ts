import {
  RUNTIME_CHECKPOINT_ENVELOPE_VERSION,
  type CheckpointResolution,
  type RuntimeCheckpointEnvelope,
} from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { isCapturedCanonicalRuntimeArtifact } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";

const validatedImmutableCheckpoints = new WeakSet<object>();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}

function markCheckpointValidated<T extends RuntimeCheckpointEnvelope<SharedExerciseState>>(value: T): T {
  deepFreeze(value);
  validatedImmutableCheckpoints.add(value);
  return value;
}

async function markCheckpointValidatedAsync<T extends RuntimeCheckpointEnvelope<SharedExerciseState>>(
  value: T,
  yieldControl: PipelineYield,
): Promise<T> {
  const pending: object[] = [value]; const seen = new WeakSet<object>(); let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    Object.values(current as Record<string, unknown>).forEach(item => {
      if (item && typeof item === "object") pending.push(item as object);
    });
    Object.freeze(current);
    visited += 1;
    if (visited % 4_096 === 0) await yieldControl();
  }
  validatedImmutableCheckpoints.add(value);
  return value;
}

function exerciseIdOf(state: SharedExerciseState): string {
  return state.exerciseSession.exerciseId;
}

function provenanceHashOf(state: SharedExerciseState): string {
  return sha256Text(stableJson((state.persistedRuntimeStates ?? []).map(item => item.provenance)
    .sort((a, b) => a.patientId.localeCompare(b.patientId))));
}

function hasValidActiveRuntimeCoverage(state: SharedExerciseState): boolean {
  const session = state.exerciseSession;
  const lifecycle = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycle !== "RUNNING" && lifecycle !== "PAUSED") return true;
  const runtimes = state.persistedRuntimeStates ?? [];
  if (!state.patients.length || !runtimes.length) return false;
  const patientIds = new Set(state.patients.map(patient => patient.id));
  const runtimePatientIds = new Set<string>();
  return runtimes.every(item => {
    const patientId = item.provenance.patientId;
    if (!patientIds.has(patientId) || runtimePatientIds.has(patientId)) return false;
    runtimePatientIds.add(patientId);
    return true;
  });
}

function hasValidRuntimeItems(state: SharedExerciseState): boolean {
  return (state.persistedRuntimeStates ?? []).every(item =>
    item.provenance.exerciseId === state.exerciseSession.exerciseId &&
    (isCapturedCanonicalRuntimeArtifact(item) || item.payloadHash === sha256Text(stableJson(item.payload))));
}

async function hasValidRuntimeItemsAsync(state: SharedExerciseState, yieldControl: PipelineYield): Promise<boolean> {
  for (const item of state.persistedRuntimeStates ?? []) {
    if (item.provenance.exerciseId !== state.exerciseSession.exerciseId) return false;
    if (!isCapturedCanonicalRuntimeArtifact(item)) {
      const canonical = await stableJsonAsync(item.payload, { yieldControl });
      if (item.payloadHash !== await sha256TextAsync(canonical, { yieldControl })) return false;
    }
  }
  return true;
}

export function createRuntimeCheckpoint(
  payload: SharedExerciseState,
  checkpointRevision: number,
): RuntimeCheckpointEnvelope<SharedExerciseState> {
  if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 1) {
    throw new Error("CHECKPOINT_REVISION_CONFLICT");
  }
  if (!hasValidActiveRuntimeCoverage(payload) || !hasValidRuntimeItems(payload)) {
    throw new Error("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  }
  const frozenPayload = structuredClone(payload);
  return markCheckpointValidated({
    envelopeVersion: RUNTIME_CHECKPOINT_ENVELOPE_VERSION,
    exerciseId: exerciseIdOf(frozenPayload),
    checkpointRevision,
    persistedRuntimeVersion: frozenPayload.persistedRuntimeStates?.[0]?.schemaVersion ?? 1,
    payload: frozenPayload,
    payloadHash: sha256Text(stableJson(frozenPayload)),
    provenanceHash: provenanceHashOf(frozenPayload),
  });
}

export async function createRuntimeCheckpointAsync(
  payload: SharedExerciseState,
  checkpointRevision: number,
  yieldControl: PipelineYield,
): Promise<RuntimeCheckpointEnvelope<SharedExerciseState>> {
  if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 1) throw new Error("CHECKPOINT_REVISION_CONFLICT");
  if (!hasValidActiveRuntimeCoverage(payload) || !await hasValidRuntimeItemsAsync(payload, yieldControl)) {
    throw new Error("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  }
  await yieldControl();
  const frozenPayload = structuredClone(payload);
  await yieldControl();
  const canonical = await stableJsonAsync(frozenPayload, { yieldControl });
  const payloadHash = await sha256TextAsync(canonical, { yieldControl });
  const checkpoint = {
    envelopeVersion: RUNTIME_CHECKPOINT_ENVELOPE_VERSION,
    exerciseId: exerciseIdOf(frozenPayload),
    checkpointRevision,
    persistedRuntimeVersion: frozenPayload.persistedRuntimeStates?.[0]?.schemaVersion ?? 1,
    payload: frozenPayload,
    payloadHash,
    provenanceHash: provenanceHashOf(frozenPayload),
  };
  return markCheckpointValidatedAsync(checkpoint, yieldControl);
}

export function isValidRuntimeCheckpoint(
  value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): value is RuntimeCheckpointEnvelope<SharedExerciseState> {
  if (value && validatedImmutableCheckpoints.has(value)) return true;
  if (!value || value.envelopeVersion !== RUNTIME_CHECKPOINT_ENVELOPE_VERSION ||
    !Number.isSafeInteger(value.checkpointRevision) || value.checkpointRevision < 1 ||
    value.exerciseId !== exerciseIdOf(value.payload)) return false;
  if (value.payloadHash !== sha256Text(stableJson(value.payload)) ||
    !hasValidActiveRuntimeCoverage(value.payload) ||
    !hasValidRuntimeItems(value.payload)) return false;
  if (value.provenanceHash !== provenanceHashOf(value.payload)) return false;
  markCheckpointValidated(value);
  return true;
}

export function resolveAuthoritativeCheckpoint(
  local: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): CheckpointResolution<SharedExerciseState> {
  const localValid = isValidRuntimeCheckpoint(local);
  const remoteValid = isValidRuntimeCheckpoint(remote);
  if (!localValid && !remoteValid) return local || remote
    ? { status: "CONFLICT", code: "CHECKPOINT_HASH_INVALID" }
    : { status: "NONE" };
  if (localValid && remoteValid && local.exerciseId !== remote.exerciseId) {
    return { status: "CONFLICT", code: "REMOTE_SYNC_CONFLICT" };
  }
  if (!remoteValid) return { status: "LOCAL", checkpoint: local! };
  if (!localValid) return { status: "REMOTE", checkpoint: remote };
  if (local.checkpointRevision === remote.checkpointRevision) {
    return local.payloadHash === remote.payloadHash
      ? { status: "EQUIVALENT", checkpoint: local }
      : { status: "CONFLICT", code: "CHECKPOINT_REVISION_DIVERGENCE" };
  }
  return local.checkpointRevision > remote.checkpointRevision
    ? { status: "LOCAL", checkpoint: local }
    : { status: "REMOTE", checkpoint: remote };
}

/**
 * Resolves a remote envelope against the checkpoint owned by
 * LocalRuntimeCheckpointStore. That store validates before restore/accept, so
 * an envelope-identical remote publication can retain the local canonical
 * object without re-hashing its large payload on the React Native UI thread.
 * All non-equivalent cases use the full fail-closed resolver.
 */
export function resolveAgainstValidatedLocalCheckpoint(
  local: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): CheckpointResolution<SharedExerciseState> {
  if (local && remote &&
    local.envelopeVersion === remote.envelopeVersion &&
    local.exerciseId === remote.exerciseId &&
    local.checkpointRevision === remote.checkpointRevision &&
    local.persistedRuntimeVersion === remote.persistedRuntimeVersion &&
    local.payloadHash === remote.payloadHash &&
    local.provenanceHash === remote.provenanceHash) {
    return { status: "EQUIVALENT", checkpoint: local };
  }
  return resolveAuthoritativeCheckpoint(local, remote);
}

class LocalRuntimeCheckpointStore {
  private checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  get(): RuntimeCheckpointEnvelope<SharedExerciseState> | undefined { return this.checkpoint; }
  restore(value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined): void {
    this.checkpoint = value && isValidRuntimeCheckpoint(value) ? value : undefined;
  }
  capture(payload: SharedExerciseState): RuntimeCheckpointEnvelope<SharedExerciseState> {
    const prior = this.checkpoint?.exerciseId === exerciseIdOf(payload) ? this.checkpoint.checkpointRevision : 0;
    this.checkpoint = createRuntimeCheckpoint(payload, prior + 1);
    return this.checkpoint;
  }
  async prepareCaptureAsync(payload: SharedExerciseState, yieldControl: PipelineYield): Promise<RuntimeCheckpointEnvelope<SharedExerciseState>> {
    const prior = this.checkpoint?.exerciseId === exerciseIdOf(payload) ? this.checkpoint.checkpointRevision : 0;
    return createRuntimeCheckpointAsync(payload, prior + 1, yieldControl);
  }
  commitPrepared(value: RuntimeCheckpointEnvelope<SharedExerciseState>): boolean {
    const prior = this.checkpoint?.exerciseId === value.exerciseId ? this.checkpoint.checkpointRevision : 0;
    if (value.checkpointRevision !== prior + 1 || !isValidRuntimeCheckpoint(value)) return false;
    this.checkpoint = value;
    return true;
  }
  accept(value: RuntimeCheckpointEnvelope<SharedExerciseState>): void {
    if (!isValidRuntimeCheckpoint(value)) throw new Error("CHECKPOINT_HASH_INVALID");
    const resolved = resolveAuthoritativeCheckpoint(this.checkpoint, value);
    if (resolved.status === "CONFLICT") throw new Error(resolved.code);
    if (resolved.status === "REMOTE" || resolved.status === "EQUIVALENT") this.checkpoint = value;
  }
}

export const localRuntimeCheckpointStore = new LocalRuntimeCheckpointStore();
