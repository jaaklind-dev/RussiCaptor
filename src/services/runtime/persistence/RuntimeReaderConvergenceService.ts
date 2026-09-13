import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { RuntimeCheckpointMetadata } from "@/services/runtime/persistence/RuntimeCheckpointMetadataCoordinator";
import { traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

type Listener = () => void;

export type RuntimeReaderConvergenceState = Readonly<{
  exerciseId?: string;
  phase: "UNTRACKED" | "SYNCHRONIZING" | "READY" | "WRITER";
  advertisedRevision?: number;
  appliedRevision?: number;
  payloadHash?: string;
  simulationTimeSec?: number;
  sessionVersion?: number;
  source?: "CACHE" | "REMOTE" | "DELTA";
  reason?: string;
}>;

const listeners = new Set<Listener>();
let version = 0;
let state: RuntimeReaderConvergenceState = Object.freeze({ phase: "UNTRACKED" });

function checkpointTime(checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): number {
  const session = checkpoint.payload.exerciseSession;
  return "simulationTimeSec" in session ? session.simulationTimeSec : session.currentMinute * 60;
}

function checkpointSessionVersion(checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>): number {
  const session = checkpoint.payload.exerciseSession;
  return "version" in session && Number.isSafeInteger(session.version) ? session.version : 0;
}

function replace(next: RuntimeReaderConvergenceState): void {
  state = Object.freeze({ ...next });
  version += 1;
  listeners.forEach(listener => listener());
}

export function beginRuntimeReaderConvergence(exerciseId: string): void {
  replace({ exerciseId, phase: "SYNCHRONIZING", reason: "AUTHORITATIVE_CHECKPOINT_PENDING" });
}

export function advertiseRuntimeReaderCheckpoint(metadata: RuntimeCheckpointMetadata): void {
  if (state.exerciseId !== metadata.exerciseId || state.phase === "WRITER") return;
  if (metadata.checkpointRevision < Math.max(state.advertisedRevision ?? 0, state.appliedRevision ?? 0)) return;
  const advertisedRevision = Math.max(state.advertisedRevision ?? 0, metadata.checkpointRevision);
  const exactApplied = state.appliedRevision === metadata.checkpointRevision && state.payloadHash === metadata.payloadHash;
  replace({ ...state, advertisedRevision,
    phase: exactApplied && advertisedRevision === metadata.checkpointRevision ? "READY" : "SYNCHRONIZING",
    reason: exactApplied && advertisedRevision === metadata.checkpointRevision ? undefined : "NEWER_AUTHORITATIVE_CHECKPOINT_PENDING" });
  traceRuntimeLeaseLifecycle("READER_CHECKPOINT_SELECTED", { detail: {
    revision: metadata.checkpointRevision,
    source: "REMOTE_METADATA",
    ready: exactApplied,
  } });
}

export function acceptRuntimeReaderCheckpoint(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  source: "CACHE" | "REMOTE" | "DELTA",
): void {
  if (state.exerciseId !== checkpoint.exerciseId || state.phase === "WRITER") return;
  const advertisedRevision = Math.max(state.advertisedRevision ?? 0, checkpoint.checkpointRevision);
  const currentAppliedRevision = state.appliedRevision ?? 0;
  if (checkpoint.checkpointRevision < currentAppliedRevision) return;
  const ready = checkpoint.checkpointRevision >= advertisedRevision;
  const simulationTimeSec = checkpointTime(checkpoint);
  replace({ exerciseId: checkpoint.exerciseId, phase: ready ? "READY" : "SYNCHRONIZING",
    advertisedRevision, appliedRevision: checkpoint.checkpointRevision, payloadHash: checkpoint.payloadHash,
    simulationTimeSec, sessionVersion: checkpointSessionVersion(checkpoint), source,
    ...(ready ? {} : { reason: "NEWER_AUTHORITATIVE_CHECKPOINT_PENDING" }) });
  traceRuntimeLeaseLifecycle("READER_RUNTIME_READY", { detail: {
    revision: checkpoint.checkpointRevision,
    simulationTimeSec,
    source,
    ready,
  } });
}

export function setRuntimeReaderConvergenceUnavailable(exerciseId: string, reason: string): void {
  if (state.exerciseId !== exerciseId || state.phase === "WRITER") return;
  replace({ ...state, phase: "SYNCHRONIZING", reason });
}

export function setRuntimeCommandAuthorityWriter(exerciseId: string): void {
  replace({ exerciseId, phase: "WRITER" });
}

export function resetRuntimeReaderConvergence(exerciseId?: string): void {
  if (exerciseId && state.exerciseId !== exerciseId) return;
  replace({ phase: "UNTRACKED" });
}

export function getRuntimeReaderConvergenceState(): RuntimeReaderConvergenceState {
  return Object.freeze({ ...state });
}

export function getRuntimeReaderConvergenceVersion(): number { return version; }

export function subscribeToRuntimeReaderConvergence(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function runtimeReaderCommandReadiness(
  exerciseId: string,
  simulationTimeSec?: number,
  trace = false,
): Readonly<{ ready: boolean; reason?: string }> {
  if (state.phase === "UNTRACKED" || state.phase === "WRITER") return Object.freeze({ ready: true });
  const exactTime = simulationTimeSec === undefined || simulationTimeSec === state.simulationTimeSec;
  const ready = state.exerciseId === exerciseId && state.phase === "READY" && exactTime;
  const reason = ready ? undefined : state.phase !== "READY"
    ? "Patsiendi Runtime sünkroniseerib värskeimat kontrollpunkti."
    : "Patsiendi simulatsiooniaeg ei ole veel autoriteetse kontrollpunktiga kooskõlas.";
  if (trace) {
    traceRuntimeLeaseLifecycle("READER_COMMAND_READINESS", { detail: {
      ready,
      revision: state.appliedRevision,
      simulationTimeSec: state.simulationTimeSec,
      requestedSimulationTimeSec: simulationTimeSec,
      reason: ready ? "READY" : state.reason ?? "SIMULATION_TIME_MISMATCH",
    } });
  }
  return Object.freeze({ ready, ...(reason ? { reason } : {}) });
}
