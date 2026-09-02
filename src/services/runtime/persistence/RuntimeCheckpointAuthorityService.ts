import {
  RUNTIME_CHECKPOINT_ENVELOPE_VERSION,
  type CheckpointResolution,
  type RuntimeCheckpointEnvelope,
} from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { isCapturedCanonicalRuntimeArtifact, markCheckpointValidatedRuntimeArtifacts } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

const validatedImmutableCheckpoints = new WeakSet<object>();
const UI_VALUES_PER_SLICE = 128;
const UI_CHARACTERS_PER_SLICE = 8_192;
const UI_SHA_BLOCKS_PER_SLICE = 16;
const UI_MAX_SLICE_MS = 8;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}

function markCheckpointValidated<T extends RuntimeCheckpointEnvelope<SharedExerciseState>>(value: T): T {
  deepFreeze(value);
  markCheckpointValidatedRuntimeArtifacts(value.payload.persistedRuntimeStates);
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
  markCheckpointValidatedRuntimeArtifacts(value.payload.persistedRuntimeStates);
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
  return (state.persistedRuntimeStates ?? []).every((item, runtimeIndex) => {
    if (item.provenance.exerciseId !== state.exerciseSession.exerciseId) return false;
    if (isCapturedCanonicalRuntimeArtifact(item)) return true;
    const endRuntimeHash = startRuntimeWorkTrace("STARTUP_CHECKPOINT_RUNTIME_HASH", { runtimeIndex });
    const valid = item.payloadHash === sha256Text(stableJson(item.payload));
    endRuntimeHash({ runtimeIndex });
    return valid;
  });
}

async function hasValidRuntimeItemsAsync(state: SharedExerciseState, yieldControl: PipelineYield): Promise<boolean> {
  for (const item of state.persistedRuntimeStates ?? []) {
    if (item.provenance.exerciseId !== state.exerciseSession.exerciseId) return false;
    if (!isCapturedCanonicalRuntimeArtifact(item)) {
      const canonical = await stableJsonAsync(item.payload, { yieldControl, yieldEvery: UI_VALUES_PER_SLICE, maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "RUNTIME_PAYLOAD" });
      if (item.payloadHash !== await sha256TextAsync(canonical, {
        yieldControl, charactersPerSlice: UI_CHARACTERS_PER_SLICE, blocksPerSlice: UI_SHA_BLOCKS_PER_SLICE, maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "RUNTIME_PAYLOAD",
      })) return false;
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
  const endCheckpoint = startRuntimeWorkTrace("CHECKPOINT_PREPARATION", {
    persistedRuntimeCount: payload.persistedRuntimeStates?.length ?? 0,
    scenarioEventCount: payload.scenarioEvents?.length ?? 0,
  });
  if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 1) throw new Error("CHECKPOINT_REVISION_CONFLICT");
  if (!hasValidActiveRuntimeCoverage(payload) || !await hasValidRuntimeItemsAsync(payload, yieldControl)) {
    throw new Error("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  }
  await yieldControl();
  const endClone = startRuntimeWorkTrace("CHECKPOINT_STRUCTURED_CLONE", { patientCount: payload.patients.length, runtimeCount: payload.persistedRuntimeStates?.length ?? 0 });
  const frozenPayload = structuredClone(payload);
  endClone();
  await yieldControl();
  const endSerialization = startRuntimeWorkTrace("CHECKPOINT_SERIALIZATION");
  const canonical = await stableJsonAsync(frozenPayload, { yieldControl, yieldEvery: UI_VALUES_PER_SLICE, maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "FULL_CHECKPOINT" });
  endSerialization({ serializedBytes: canonical.length });
  const endHash = startRuntimeWorkTrace("CHECKPOINT_HASH");
  const payloadHash = await sha256TextAsync(canonical, {
    yieldControl, charactersPerSlice: UI_CHARACTERS_PER_SLICE, blocksPerSlice: UI_SHA_BLOCKS_PER_SLICE, maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "FULL_CHECKPOINT",
  });
  endHash({ serializedBytes: canonical.length });
  const checkpoint = {
    envelopeVersion: RUNTIME_CHECKPOINT_ENVELOPE_VERSION,
    exerciseId: exerciseIdOf(frozenPayload),
    checkpointRevision,
    persistedRuntimeVersion: frozenPayload.persistedRuntimeStates?.[0]?.schemaVersion ?? 1,
    payload: frozenPayload,
    payloadHash,
    provenanceHash: provenanceHashOf(frozenPayload),
  };
  const endFreeze = startRuntimeWorkTrace("CHECKPOINT_FREEZE");
  const validated = await markCheckpointValidatedAsync(checkpoint, yieldControl);
  endFreeze();
  endCheckpoint({ serializedBytes: canonical.length });
  return validated;
}

export function isValidRuntimeCheckpoint(
  value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): value is RuntimeCheckpointEnvelope<SharedExerciseState> {
  if (value && validatedImmutableCheckpoints.has(value)) return true;
  const endEnvelope = startRuntimeWorkTrace("STARTUP_CHECKPOINT_ENVELOPE_VALIDATE");
  if (!value || value.envelopeVersion !== RUNTIME_CHECKPOINT_ENVELOPE_VERSION ||
    !Number.isSafeInteger(value.checkpointRevision) || value.checkpointRevision < 1 ||
    value.exerciseId !== exerciseIdOf(value.payload)) { endEnvelope({ valid: false }); return false; }
  endEnvelope({ valid: true });
  const endPayloadHash = startRuntimeWorkTrace("STARTUP_CHECKPOINT_FULL_HASH");
  if (value.payloadHash !== sha256Text(stableJson(value.payload))) { endPayloadHash({ valid: false }); return false; }
  endPayloadHash({ valid: true });
  const endCoverage = startRuntimeWorkTrace("STARTUP_CHECKPOINT_RUNTIME_COVERAGE");
  if (!hasValidActiveRuntimeCoverage(value.payload)) { endCoverage({ valid: false }); return false; }
  endCoverage({ valid: true });
  const endRuntimeItems = startRuntimeWorkTrace("STARTUP_CHECKPOINT_RUNTIME_ITEMS");
  if (!hasValidRuntimeItems(value.payload)) { endRuntimeItems({ valid: false }); return false; }
  endRuntimeItems({ valid: true });
  const endProvenance = startRuntimeWorkTrace("STARTUP_CHECKPOINT_PROVENANCE_HASH");
  if (value.provenanceHash !== provenanceHashOf(value.payload)) { endProvenance({ valid: false }); return false; }
  endProvenance({ valid: true });
  const endFreeze = startRuntimeWorkTrace("STARTUP_CHECKPOINT_FREEZE");
  markCheckpointValidated(value);
  endFreeze();
  return true;
}

/**
 * Startup-only counterpart to the fail-closed synchronous validator. It uses
 * the identical canonical JSON and SHA-256 definitions, but permits the UI
 * thread to yield between bounded serializer/hash slices.
 */
export async function isValidRuntimeCheckpointAsync(
  value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  yieldControl: PipelineYield,
): Promise<boolean> {
  if (value && validatedImmutableCheckpoints.has(value)) return true;
  if (!value || value.envelopeVersion !== RUNTIME_CHECKPOINT_ENVELOPE_VERSION ||
    !Number.isSafeInteger(value.checkpointRevision) || value.checkpointRevision < 1 ||
    value.exerciseId !== exerciseIdOf(value.payload)) return false;
  const canonical = await stableJsonAsync(value.payload, {
    yieldControl, yieldEvery: UI_VALUES_PER_SLICE, maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "FULL_CHECKPOINT",
  });
  const payloadHash = await sha256TextAsync(canonical, {
    yieldControl, charactersPerSlice: UI_CHARACTERS_PER_SLICE, blocksPerSlice: UI_SHA_BLOCKS_PER_SLICE,
    maxSliceMs: UI_MAX_SLICE_MS, traceCategory: "FULL_CHECKPOINT",
  });
  if (value.payloadHash !== payloadHash || !hasValidActiveRuntimeCoverage(value.payload) ||
    !await hasValidRuntimeItemsAsync(value.payload, yieldControl) ||
    value.provenanceHash !== provenanceHashOf(value.payload)) return false;
  await markCheckpointValidatedAsync(value, yieldControl);
  return true;
}

/**
 * The authoritative selection rules are deliberately identical to the
 * synchronous resolver below.  Startup callers use this counterpart for a
 * remotely deserialized envelope so canonicalization and hashing yield inside
 * their real traversal work rather than blocking the React Native JS thread.
 */
export async function resolveAuthoritativeCheckpointAsync(
  local: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  yieldControl: PipelineYield,
): Promise<CheckpointResolution<SharedExerciseState>> {
  let localYields = 0;
  const localYield: PipelineYield = async () => { localYields += 1; await yieldControl(); };
  const endLocal = startRuntimeWorkTrace("STARTUP_CHECKPOINT_LOCAL_VALIDATE_ASYNC", {
    checkpointRevision: local?.checkpointRevision,
  });
  const localValid = await isValidRuntimeCheckpointAsync(local, localYield);
  endLocal({ valid: localValid, yieldCount: localYields });

  let remoteYields = 0;
  const remoteYield: PipelineYield = async () => { remoteYields += 1; await yieldControl(); };
  const endRemote = startRuntimeWorkTrace("STARTUP_CHECKPOINT_REMOTE_VALIDATE_ASYNC", {
    checkpointRevision: remote?.checkpointRevision,
    persistedRuntimeCount: remote?.payload.persistedRuntimeStates?.length ?? 0,
  });
  const remoteValid = await isValidRuntimeCheckpointAsync(remote, remoteYield);
  endRemote({ valid: remoteValid, yieldCount: remoteYields });
  const validLocal = localValid ? local! : undefined;
  const validRemote = remoteValid ? remote! : undefined;

  if (!localValid && !remoteValid) return local || remote
    ? { status: "CONFLICT", code: "CHECKPOINT_HASH_INVALID" }
    : { status: "NONE" };
  if (validLocal && validRemote && validLocal.exerciseId !== validRemote.exerciseId) {
    return { status: "CONFLICT", code: "REMOTE_SYNC_CONFLICT" };
  }
  if (!validRemote) return { status: "LOCAL", checkpoint: validLocal! };
  if (!validLocal) return { status: "REMOTE", checkpoint: validRemote };
  if (validLocal.checkpointRevision === validRemote.checkpointRevision) {
    return validLocal.payloadHash === validRemote.payloadHash
      ? { status: "EQUIVALENT", checkpoint: validLocal }
      : { status: "CONFLICT", code: "CHECKPOINT_REVISION_DIVERGENCE" };
  }
  return validLocal.checkpointRevision > validRemote.checkpointRevision
    ? { status: "LOCAL", checkpoint: validLocal }
    : { status: "REMOTE", checkpoint: validRemote };
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

/** A lease-free reader repairs a locally prepared, rejected same-revision
 * checkpoint from the valid durable subscription payload. Writers retain the
 * normal fail-closed divergence behavior. */
export function resolveSubscribedCheckpoint(
  local: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  remote: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  ownsWriterLease: boolean,
): CheckpointResolution<SharedExerciseState> {
  const resolved = resolveAuthoritativeCheckpoint(local, remote);
  return !ownsWriterLease && remote && isValidRuntimeCheckpoint(remote) &&
    resolved.status === "CONFLICT" && resolved.code === "CHECKPOINT_REVISION_DIVERGENCE"
    ? { status: "REMOTE", checkpoint: remote }
    : resolved;
}

class LocalRuntimeCheckpointStore {
  private checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  get(): RuntimeCheckpointEnvelope<SharedExerciseState> | undefined { return this.checkpoint; }
  restore(value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined): void {
    this.checkpoint = value && isValidRuntimeCheckpoint(value) ? value : undefined;
  }
  async restoreAsync(value: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined, yieldControl: PipelineYield): Promise<void> {
    this.checkpoint = value && await isValidRuntimeCheckpointAsync(value, yieldControl) ? value : undefined;
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
