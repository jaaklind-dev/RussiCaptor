import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AcceptedRuntimePatientCommand,
  RuntimePatientCommandMaterialization,
  RuntimePatientCommandSubmission,
  RuntimePatientCommandSubmissionResult,
} from "@/models/RuntimePatientCommand";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getSharedWorkflowHead, observeSharedWorkflowHead } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { supabase } from "@/services/SupabaseService";
import { notifySync } from "@/services/SyncService";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { advanceRuntimePatientCommandCursor, getRuntimePatientCommandCursor } from "./RuntimePatientCommandCursor";

export interface RuntimePatientCommandGateway {
  submit(command: RuntimePatientCommandSubmission): Promise<RuntimePatientCommandSubmissionResult>;
  loadAfter(exerciseId: string, cursor: number, throughSequence?: number): Promise<readonly AcceptedRuntimePatientCommand[]>;
  record(exerciseId: string, commandSequence: number, lease: RuntimeWriterLease,
    materialization: RuntimePatientCommandMaterialization): Promise<void>;
}

function errorStatus(message: string): RuntimePatientCommandSubmissionResult["status"] {
  if (message.includes("COMPLETION_FENCED")) return "COMPLETION_FENCED";
  if (message.includes("EXERCISE_NOT_ACTIVE")) return "EXERCISE_NOT_ACTIVE";
  if (message.includes("AUTHORIZATION_DENIED") || message.includes("AUTHENTICATION_REQUIRED")) return "AUTHORIZATION_DENIED";
  return "UNAVAILABLE";
}

export class SupabaseRuntimePatientCommandGateway implements RuntimePatientCommandGateway {
  constructor(private readonly client: SupabaseClient) {}

  async submit(command: RuntimePatientCommandSubmission): Promise<RuntimePatientCommandSubmissionResult> {
    const { data, error } = await this.client.rpc("submit_runtime_patient_command", {
      p_exercise_id: command.exerciseId,
      p_patient_id: command.patientId,
      p_command_id: command.commandId,
      p_command_type: command.commandType,
      p_expected_patient_revision: command.patientBaseRevision,
      p_simulation_time_sec: command.simulationTimeSec,
      p_command_payload: command.payload,
    });
    if (error) return Object.freeze({ status: errorStatus(error.message), patientRevision: command.patientBaseRevision });
    const row = (Array.isArray(data) ? data[0] : data) as {
      status: RuntimePatientCommandSubmissionResult["status"];
      command_sequence?: number;
      patient_revision: number;
      owner_user_id?: string;
    };
    return Object.freeze({ status: row.status, commandSequence: row.command_sequence === undefined ? undefined : Number(row.command_sequence),
      patientRevision: Number(row.patient_revision), ownerUserId: row.owner_user_id ?? undefined });
  }

  async loadAfter(exerciseId: string, cursor: number, throughSequence?: number): Promise<readonly AcceptedRuntimePatientCommand[]> {
    let query = this.client.from("runtime_patient_commands").select("command_sequence,exercise_id,patient_id,command_id,command_type,command_payload,patient_base_revision,patient_resulting_revision,simulation_time_sec,actor_user_id")
      .eq("exercise_id", exerciseId).gt("command_sequence", cursor).order("command_sequence", { ascending: true });
    if (throughSequence !== undefined) query = query.lte("command_sequence", throughSequence);
    const { data, error } = await query;
    if (error) throw new Error("RUNTIME_COMMAND_LOAD_FAILED");
    return Object.freeze((data ?? []).map(row => Object.freeze({
      exerciseId: String(row.exercise_id), patientId: String(row.patient_id), commandId: String(row.command_id),
      commandType: row.command_type as AcceptedRuntimePatientCommand["commandType"],
      patientBaseRevision: Number(row.patient_base_revision), patientResultingRevision: Number(row.patient_resulting_revision),
      simulationTimeSec: Number(row.simulation_time_sec), payload: row.command_payload as Readonly<Record<string, unknown>>,
      commandSequence: Number(row.command_sequence), actorUserId: String(row.actor_user_id),
    })));
  }

  async record(exerciseId: string, commandSequence: number, lease: RuntimeWriterLease,
    materialization: RuntimePatientCommandMaterialization): Promise<void> {
    const { error } = await this.client.rpc("record_runtime_patient_command_result", {
      p_exercise_id: exerciseId, p_command_sequence: commandSequence, p_lease_id: lease.leaseId,
      p_writer_instance_id: lease.writerInstanceId, p_status: materialization.status, p_result: materialization.result,
    });
    if (error) throw new Error(error.message.includes("STALE_WRITER") ? "STALE_WRITER" : "RUNTIME_COMMAND_RESULT_FAILED");
  }
}

let gateway: RuntimePatientCommandGateway | undefined = supabase ? new SupabaseRuntimePatientCommandGateway(supabase) : undefined;
export function setRuntimePatientCommandGateway(value: RuntimePatientCommandGateway | undefined): void { gateway = value; }

export async function submitPatientRuntimeCommand(input: Omit<RuntimePatientCommandSubmission, "patientBaseRevision" | "simulationTimeSec"> &
Readonly<{ simulationTimeSec?: number }>): Promise<RuntimePatientCommandSubmissionResult> {
  const head = getSharedWorkflowHead(input.exerciseId, input.patientId);
  if (!gateway) return Object.freeze({ status: "UNAVAILABLE", patientRevision: head.revision, ownerUserId: head.ownerUserId });
  const exercise = getCanonicalExerciseSnapshot();
  if (exercise.exerciseId !== input.exerciseId || exercise.lifecycleState !== "RUNNING") {
    return Object.freeze({ status: "EXERCISE_NOT_ACTIVE", patientRevision: head.revision, ownerUserId: head.ownerUserId });
  }
  const result = await gateway.submit(Object.freeze({ ...input, patientBaseRevision: head.revision,
    simulationTimeSec: input.simulationTimeSec ?? exercise.simulationTimeSec }));
  if (result.status === "APPLIED" || result.status === "IDEMPOTENT") {
    observeSharedWorkflowHead(input.exerciseId, input.patientId, result.patientRevision, result.ownerUserId);
  }
  return result;
}

export type RuntimePatientCommandMaterializer = (command: AcceptedRuntimePatientCommand) =>
  Promise<RuntimePatientCommandMaterialization> | RuntimePatientCommandMaterialization;

export class RuntimePatientCommandConsumer {
  private active?: Promise<number>;
  constructor(private readonly commandGateway: RuntimePatientCommandGateway,
    private readonly materialize: RuntimePatientCommandMaterializer) {}

  drain(exerciseId: string, lease: RuntimeWriterLease, throughSequence?: number): Promise<number> {
    if (this.active) return this.active;
    const run = this.drainOnce(exerciseId, lease, throughSequence).finally(() => {
      if (this.active === run) this.active = undefined;
    });
    this.active = run;
    return run;
  }

  private async drainOnce(exerciseId: string, lease: RuntimeWriterLease, throughSequence?: number): Promise<number> {
    let cursor = getRuntimePatientCommandCursor(exerciseId);
    const commands = await this.commandGateway.loadAfter(exerciseId, cursor, throughSequence);
    for (const command of commands) {
      const materialization = await this.materialize(command);
      await this.commandGateway.record(exerciseId, command.commandSequence, lease, materialization);
      advanceRuntimePatientCommandCursor(exerciseId, command.commandSequence);
      cursor = command.commandSequence;
      notifySync("local");
    }
    return cursor;
  }
}

export function getRuntimePatientCommandGateway(): RuntimePatientCommandGateway | undefined { return gateway; }
