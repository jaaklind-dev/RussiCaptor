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
