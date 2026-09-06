import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";
import type {
  ExerciseProjectionRecord,
  PackageDivergenceRecoveryExpectation,
  PackageDivergenceRecoveryRepository,
  PackageProjectionDivergenceRecoveryCode,
} from "@/services/runtime/exercise/PackageProjectionDivergenceRecoveryService";

type RecoveryRow = Readonly<{
  result_code: PackageProjectionDivergenceRecoveryCode;
  audit_id?: string;
  recovered_state?: SharedExerciseState | null;
}>;

export class SupabasePackageProjectionDivergenceRecoveryRepository implements PackageDivergenceRecoveryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadProjection(exerciseId: string): Promise<ExerciseProjectionRecord | undefined> {
    const { data, error } = await this.client.from("exercise_states")
      .select("exercise_id,revision,state").eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "exercise_states.package_divergence_projection", data, fullSnapshot: true });
    if (error) throw new Error("RECOVERY_BACKEND_FAILED");
    if (!data) return undefined;
    return Object.freeze({ exerciseId: data.exercise_id, revision: Number(data.revision), state: data.state as SharedExerciseState });
  }

  async loadCheckpoint(exerciseId: string): Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined> {
    const { data, error } = await this.client.from("runtime_checkpoints")
      .select("payload").eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_checkpoints.package_divergence_validation", data, fullSnapshot: true });
    if (error) throw new Error("RECOVERY_BACKEND_FAILED");
    return data?.payload as RuntimeCheckpointEnvelope<SharedExerciseState> | undefined;
  }

  async hasActiveWriterLease(exerciseId: string): Promise<boolean> {
    const { data, error } = await this.client.from("runtime_writer_leases")
      .select("lease_id,expires_at,released_at").eq("exercise_id", exerciseId).maybeSingle();
    recordSupabaseTraffic({ operation: "SELECT", endpoint: "runtime_writer_leases.package_divergence", data });
    if (error) throw new Error("RECOVERY_BACKEND_FAILED");
    return Boolean(data && !data.released_at && Date.parse(data.expires_at) > Date.now());
  }

  async terminalize(expectation: PackageDivergenceRecoveryExpectation) {
    const { data, error } = await this.client.rpc("terminalize_package_projection_divergence", {
      p_exercise_id: expectation.exerciseId,
      p_expected_projection_revision: expectation.projectionRevision,
      p_expected_checkpoint_revision: expectation.checkpointRevision,
      p_expected_payload_hash: expectation.payloadHash,
      p_expected_provenance_hash: expectation.provenanceHash,
      p_expected_session_version: expectation.sessionVersion,
      p_expected_lifecycle: expectation.lifecycle,
      p_expected_projection_package_id: expectation.projectionPackage.packageId,
      p_expected_projection_package_version: expectation.projectionPackage.packageVersion,
      p_expected_checkpoint_package_id: expectation.checkpointPackage.packageId,
      p_expected_checkpoint_package_version: expectation.checkpointPackage.packageVersion,
    });
    recordSupabaseTraffic({ operation: "RPC", endpoint: "terminalize_package_projection_divergence", data, fullSnapshot: true });
    if (error) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" as const });
    const row = (Array.isArray(data) ? data[0] : data) as RecoveryRow | undefined;
    if (!row?.result_code) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" as const });
    return Object.freeze({ code: row.result_code,
      ...(row.audit_id ? { auditId: row.audit_id } : {}),
      ...(row.recovered_state ? { state: row.recovered_state } : {}),
    });
  }
}
