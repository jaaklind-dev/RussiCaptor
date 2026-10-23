import { supabase } from "@/services/SupabaseService";
import { getOperatorSession } from "@/services/authorization/OperatorSessionService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { activeExercisePackageService } from "./ActiveExercisePackageService";
import { captureCompletedExerciseArchive } from "./ExercisePreparationService";
import { storeCompletedExerciseArchive } from "./CompletedExerciseArchiveService";
import { createExerciseWithExistingBootstrap, getAdminExerciseCreationPhase } from "@/services/admin/PlatformAdminExerciseCreation";
import type { ExerciseBootstrapAuthorization } from "@/services/admin/PlatformAdminService";

/** New operational exercises require pre-issued server bootstrap authority.
 * An identity-preserving restore must never call this new-identity operation. */
export async function prepareAllocatedExercise(operationId: string): Promise<string> {
  const current = getCanonicalExerciseSnapshot();
  // Reconcile an already committed operation before treating this as a fresh
  // lifecycle transition. The orchestrator retains the exact actor/package key.
  const succeeded = getAdminExerciseCreationPhase(operationId) === "SUCCEEDED";
  if (!succeeded && current.lifecycleState !== "COMPLETED" && !(current.lifecycleState === "READY" && current.exerciseId === "demo")) {
    throw new Error("Lõpeta aktiivne õppus enne uue ettevalmistamist.");
  }
  const operator = getOperatorSession();
  const pkg = activeExercisePackageService.getActive();
  if (operator.state !== "AUTHENTICATED" || !pkg || !supabase) throw new Error("Õppuse loomise õigus või pakett puudub.");
  const userId = operator.profile.userId;
  const archive = !succeeded && current.lifecycleState === "COMPLETED" ? captureCompletedExerciseArchive() : undefined;
  const assertUnchanged = () => {
    const now = getCanonicalExerciseSnapshot();
    const session = getOperatorSession();
    if (now.exerciseId !== current.exerciseId || now.version !== current.version
      || now.lifecycleState !== current.lifecycleState || session.state !== "AUTHENTICATED"
      || session.profile.userId !== userId) throw new Error("Õppuse olek muutus. Kohalik aktiveerimine peatati.");
    // Register the immutable completed snapshot before replacing the live
    // projection. A later activation/notification failure cannot lose it.
    // The archive store is idempotent by exact historical exercise identity.
    if (archive) storeCompletedExerciseArchive(archive);
  };
  const id = await createExerciseWithExistingBootstrap(userId,
    { packageId: pkg.packageId, packageVersion: pkg.packageVersion }, operationId, async () => {
      const { data, error } = await supabase!.from("exercise_bootstrap_authorizations")
        .select("id,user_id,status,consumed_exercise_id,expires_at")
        .eq("user_id", userId).eq("status", "ACTIVE").is("consumed_exercise_id", null)
        .gt("expires_at", new Date().toISOString()).order("id").limit(1).maybeSingle();
      if (error || !data || data.user_id !== userId) throw new Error("ADMIN_EXERCISE_BOOTSTRAP_UNAVAILABLE");
      return data as ExerciseBootstrapAuthorization;
    }, assertUnchanged);
  if (archive) storeCompletedExerciseArchive(archive);
  return id;
}
