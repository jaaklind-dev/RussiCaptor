import { refreshOperatorSession } from "@/services/authorization/OperatorSessionService";
import { createExercisePreparationCommand, exercisePreparationService } from "@/services/exercise/ExercisePreparationService";
import { grantExerciseBootstrap } from "./PlatformAdminService";

type PreparationResult = Readonly<{ ok: true; exerciseId: string }> | Readonly<{ ok: false; message: string }>;

export type AdminExerciseCreationDependencies = Readonly<{
  grantBootstrap: (userId: string) => Promise<unknown>;
  refreshSession: () => Promise<unknown>;
  prepare: () => PreparationResult;
}>;

const defaultDependencies: AdminExerciseCreationDependencies = Object.freeze({
  grantBootstrap: grantExerciseBootstrap,
  refreshSession: refreshOperatorSession,
  prepare: () => exercisePreparationService.prepare(createExercisePreparationCommand()),
});

export async function createAdminExercise(
  userId: string,
  dependencies: AdminExerciseCreationDependencies = defaultDependencies,
): Promise<string> {
  await dependencies.grantBootstrap(userId);
  await dependencies.refreshSession();
  const result = dependencies.prepare();
  if (!result.ok) throw new Error(result.message);
  return result.exerciseId;
}
