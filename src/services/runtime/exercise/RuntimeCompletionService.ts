import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExerciseControlCommand, ExerciseControlResult } from "@/models/exercise/ExerciseControlCommand";
import type { ExerciseLifecycleState } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { RuntimeCompletionRequest, RuntimeCompletionSubmissionResult } from "@/models/RuntimeCompletion";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { supabase } from "@/services/SupabaseService";

export interface RuntimeCompletionGateway {
  submit(exerciseId: string, commandId: string, expectedExerciseVersion: number): Promise<RuntimeCompletionSubmissionResult>;
  load(exerciseId: string): Promise<RuntimeCompletionRequest | undefined>;
}

export class SupabaseRuntimeCompletionGateway implements RuntimeCompletionGateway {
  constructor(private readonly client: SupabaseClient) {}
  async submit(exerciseId: string, commandId: string, expectedExerciseVersion: number): Promise<RuntimeCompletionSubmissionResult> {
    const { data, error } = await this.client.rpc("submit_runtime_completion_request", {
      p_exercise_id: exerciseId, p_command_id: commandId, p_expected_exercise_version: expectedExerciseVersion,
    });
    if (error) return Object.freeze({ status: "REJECTED", code: error.message.includes("VERSION_CONFLICT") ? "VERSION_CONFLICT"
      : error.message.includes("AUTHORIZATION_DENIED") ? "UNAUTHORIZED" : error.message.includes("COMPLETION_ALREADY_FENCED")
        ? "COMPLETION_ALREADY_FENCED" : error.message.includes("INVALID_TRANSITION") ? "INVALID_TRANSITION" : "AUTHORITY_UNAVAILABLE" });
    const row = (Array.isArray(data) ? data[0] : data) as { status: "PENDING" | "COMPLETED";
      fence_command_sequence: number; terminal_checkpoint_revision?: number };
    return Object.freeze({ status: row.status, fenceCommandSequence: Number(row.fence_command_sequence),
      terminalCheckpointRevision: row.terminal_checkpoint_revision === null || row.terminal_checkpoint_revision === undefined
        ? undefined : Number(row.terminal_checkpoint_revision) });
  }
  async load(exerciseId: string): Promise<RuntimeCompletionRequest | undefined> {
    const { data, error } = await this.client.from("runtime_completion_requests")
      .select("exercise_id,command_id,requested_by,expected_exercise_version,fence_command_sequence,status,terminal_checkpoint_revision,terminal_payload_hash")
      .eq("exercise_id", exerciseId).maybeSingle();
    if (error) throw new Error("COMPLETION_REQUEST_LOAD_FAILED");
    if (!data) return undefined;
    return Object.freeze({ exerciseId: String(data.exercise_id), commandId: String(data.command_id),
      requestedBy: String(data.requested_by), expectedExerciseVersion: Number(data.expected_exercise_version),
      fenceCommandSequence: Number(data.fence_command_sequence), status: data.status as "PENDING" | "COMPLETED",
      terminalCheckpointRevision: data.terminal_checkpoint_revision == null ? undefined : Number(data.terminal_checkpoint_revision),
      terminalPayloadHash: data.terminal_payload_hash ?? undefined });
  }
}

export type RuntimeCompletionPhase = "IDLE" | "PENDING" | "FINALIZING" | "COMPLETED" | "FAILED";
let phase: Readonly<{ exerciseId?: string; phase: RuntimeCompletionPhase; code?: string }> = Object.freeze({ phase: "IDLE" });
const listeners = new Set<() => void>();
let gateway: RuntimeCompletionGateway | undefined = supabase ? new SupabaseRuntimeCompletionGateway(supabase) : undefined;

export function setRuntimeCompletionGateway(value: RuntimeCompletionGateway | undefined): void { gateway = value; }
export function getRuntimeCompletionGateway(): RuntimeCompletionGateway | undefined { return gateway; }
export function setRuntimeCompletionPhase(exerciseId: string, next: RuntimeCompletionPhase, code?: string): void {
  phase = Object.freeze({ exerciseId, phase: next, code }); listeners.forEach(listener => listener());
}
export function getRuntimeCompletionPhase(): typeof phase { return phase; }
export function subscribeToRuntimeCompletionPhase(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function getRuntimeCompletionPresentation(exerciseId: string, localLifecycle: ExerciseLifecycleState): Readonly<{
  awaitingAuthoritativeAck: boolean;
  lifecycleState: ExerciseLifecycleState;
  lifecycleLabel: string;
}> {
  const awaitingAuthoritativeAck = phase.exerciseId === exerciseId
    && (phase.phase === "PENDING" || phase.phase === "FINALIZING" || phase.phase === "FAILED");
  return Object.freeze({
    awaitingAuthoritativeAck,
    lifecycleState: awaitingAuthoritativeAck && localLifecycle === "COMPLETED" ? "RUNNING" : localLifecycle,
    lifecycleLabel: awaitingAuthoritativeAck ? "Lõpetamine" : localLifecycle === "COMPLETED" ? "Lõpetatud" : "",
  });
}
export function terminalProjectionOwnedByCheckpointProtocol(exerciseId: string): boolean {
  return phase.exerciseId === exerciseId && ["PENDING", "FINALIZING", "COMPLETED"].includes(phase.phase);
}

function failure(command: ExerciseControlCommand, code: string, message: string): ExerciseControlResult {
  return Object.freeze({ ok: false, commandId: command.commandId,
    errorCode: code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : code === "INVALID_TRANSITION" ? "INVALID_TRANSITION"
      : code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "RUNTIME_FAILURE", message });
}

/** Completion is successful to the operator only after the atomic terminal RPC is observable. */
export async function submitRuntimeCompletion(command: ExerciseControlCommand, timeoutMs = 120_000): Promise<ExerciseControlResult> {
  if (!gateway) return failure(command, "AUTHORITY_UNAVAILABLE", "Lõpetamise autoriteetne teenus ei ole saadaval.");
  const submitted = await gateway.submit(command.exerciseId, command.commandId, command.expectedVersion ?? 0);
  if (submitted.status === "REJECTED" || submitted.status === "UNAVAILABLE") {
    setRuntimeCompletionPhase(command.exerciseId, "FAILED", submitted.code);
    return failure(command, submitted.code ?? "RUNTIME_FAILURE", "Õppuse lõpetamist ei saanud autoritaarselt alustada.");
  }
  setRuntimeCompletionPhase(command.exerciseId, submitted.status === "COMPLETED" ? "COMPLETED" : "PENDING");
  const deadline = Date.now() + timeoutMs;
  let observed = submitted;
  while (observed.status !== "COMPLETED" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    let current: RuntimeCompletionRequest | undefined;
    try { current = await gateway.load(command.exerciseId); }
    catch {
      setRuntimeCompletionPhase(command.exerciseId, "PENDING", "COMPLETION_RECONCILIATION_UNAVAILABLE");
      return failure(command, "RUNTIME_FAILURE", "Õppuse lõpetamine on ootel. Autoritaarse lõppseisu kontroll ei ole hetkel saadaval.");
    }
    if (current?.status === "COMPLETED") observed = Object.freeze({ status: "COMPLETED",
      fenceCommandSequence: current.fenceCommandSequence, terminalCheckpointRevision: current.terminalCheckpointRevision });
  }
  if (observed.status !== "COMPLETED") {
    setRuntimeCompletionPhase(command.exerciseId, "PENDING", "TERMINALIZATION_PENDING");
    return failure(command, "RUNTIME_FAILURE", "Õppuse lõpetamine on ootel. Autoritaarne Runtime jätkab turvalist terminaliseerimist.");
  }
  setRuntimeCompletionPhase(command.exerciseId, "COMPLETED");
  const snapshot = getCanonicalExerciseSnapshot();
  return Object.freeze({ ok: true, commandId: command.commandId,
    snapshot: Object.freeze({ ...snapshot, lifecycleState: "COMPLETED" }), eventType: "ExerciseCompleted" });
}
