import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { authorizeCurrentPrincipal, getAuthorizationPrincipal, refreshAuthorizationPrincipal } from "@/services/AuthorizationFoundationService";
import { clearActiveClinicalReferenceRuntime } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import { ExerciseRuntimeRecoveryService } from "@/services/runtime/exercise/ExerciseRuntimeRecoveryService";
import { SupabaseExerciseRuntimeRecoveryRepository } from "@/services/runtime/exercise/SupabaseExerciseRuntimeRecoveryRepository";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { restoreSharedExerciseState } from "@/services/StatePersistenceService";
import { notifySync } from "@/services/SyncService";
import { supabase } from "@/services/SupabaseService";
import { terminateStaleRuntimeAfterLeaseExpiry, type StaleRuntimeTerminalizationCode } from "@/services/runtime/exercise/StaleRuntimeTerminalizationService";
import { PackageProjectionDivergenceRecoveryService, type PackageProjectionDivergenceRecoveryCode } from "@/services/runtime/exercise/PackageProjectionDivergenceRecoveryService";
import { SupabasePackageProjectionDivergenceRecoveryRepository } from "@/services/runtime/exercise/SupabasePackageProjectionDivergenceRecoveryRepository";

const repository = supabase ? new SupabaseExerciseRuntimeRecoveryRepository(supabase, state => {
  clearActiveClinicalReferenceRuntime();
  restoreSharedExerciseState(state, false);
  setRuntimeWriterAuthorityState("UNRESOLVED");
  setRuntimePersistenceFailure(undefined);
  notifySync("remote");
}) : undefined;
const service = repository ? new ExerciseRuntimeRecoveryService(repository, async (state, exerciseId) =>
  (await authorizeCurrentPrincipal("EXERCISE_RUNTIME_RECOVERY", { exerciseId })).status === "AUTHORIZED" && state.state === "AUTHENTICATED"
) : undefined;
const packageDivergenceService = supabase
  ? new PackageProjectionDivergenceRecoveryService(new SupabasePackageProjectionDivergenceRecoveryRepository(supabase))
  : undefined;

export async function terminateExerciseWithMissingRuntime(exerciseId: string, expectedVersion: number) {
  if (!service) return { ok: false as const, code: "RECOVERY_BACKEND_FAILED" as const, message: "Exercise recovery backend is unavailable." };
  const state = await refreshAuthorizationPrincipal();
  return service.terminate(state, { exerciseId, expectedVersion, persistenceFailure: "ACTIVE_RUNTIME_PERSISTENCE_MISSING" });
}

export async function terminateCurrentExerciseWithMissingRuntime() {
  const snapshot = getCanonicalExerciseSnapshot();
  return terminateExerciseWithMissingRuntime(snapshot.exerciseId, snapshot.version);
}

export function getCurrentRecoveryPrincipal() { return getAuthorizationPrincipal(); }

export async function terminateStaleRuntimeAfterExpiredLease(exerciseId: string): Promise<Readonly<{ code: StaleRuntimeTerminalizationCode; auditId?: string }>> {
  if (!supabase) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" });
  const authorization = await authorizeCurrentPrincipal("EXERCISE_RUNTIME_RECOVERY", { exerciseId });
  if (authorization.status !== "AUTHORIZED") return Object.freeze({ code: "AUTHORIZATION_DENIED" });
  const result = await terminateStaleRuntimeAfterLeaseExpiry(supabase, exerciseId);
  if (result.state) {
    clearActiveClinicalReferenceRuntime();
    restoreSharedExerciseState(result.state, false);
    setRuntimeWriterAuthorityState("UNRESOLVED");
    setRuntimePersistenceFailure(undefined);
    notifySync("remote");
  }
  return Object.freeze({ code: result.code, ...(result.auditId ? { auditId: result.auditId } : {}) });
}

export async function terminalizePackageProjectionDivergence(exerciseId: string): Promise<Readonly<{
  code: PackageProjectionDivergenceRecoveryCode;
  auditId?: string;
}>> {
  if (!packageDivergenceService) return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" });
  const authorization = await authorizeCurrentPrincipal("EXERCISE_RUNTIME_RECOVERY", { exerciseId });
  if (authorization.status !== "AUTHORIZED") return Object.freeze({ code: "RECOVERY_NOT_AUTHORIZED" });
  const result = await packageDivergenceService.terminalize(exerciseId);
  if (result.state && (result.code === "TERMINALIZED_DIVERGENT_STATE" || result.code === "ALREADY_TERMINAL")) {
    clearActiveClinicalReferenceRuntime();
    restoreSharedExerciseState(result.state, false);
    setRuntimeWriterAuthorityState("UNRESOLVED");
    setRuntimePersistenceFailure(undefined);
    notifySync("remote");
  }
  return Object.freeze({ code: result.code, ...(result.auditId ? { auditId: result.auditId } : {}) });
}
