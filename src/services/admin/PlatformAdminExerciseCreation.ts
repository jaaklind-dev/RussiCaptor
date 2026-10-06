import { refreshOperatorSession } from "@/services/authorization/OperatorSessionService";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { createExercisePreparationCommand, exercisePreparationService } from "@/services/exercise/ExercisePreparationService";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { AdminPackageIdentity } from "./AdminPackageSelectionService";
import { grantExerciseBootstrap } from "./PlatformAdminService";

type PreparationResult = Readonly<{ ok: true; exerciseId: string; exercisePackage: ExercisePackage }> | Readonly<{ ok: false; message: string }>;

export type AdminExerciseCreationDependencies = Readonly<{
  resolvePackage: (identity: AdminPackageIdentity) => ExercisePackage | undefined;
  grantBootstrap: (userId: string) => Promise<unknown>;
  refreshSession: () => Promise<unknown>;
  prepare: (identity: AdminPackageIdentity) => PreparationResult;
}>;

const defaultDependencies: AdminExerciseCreationDependencies = Object.freeze({
  resolvePackage: identity => exercisePackageRegistry.get(identity.packageId, identity.packageVersion),
  grantBootstrap: grantExerciseBootstrap,
  refreshSession: refreshOperatorSession,
  prepare: identity => {
    const activation = activeExercisePackageService.activateWithResult(identity.packageId, identity.packageVersion);
    if (!activation.ok) return Object.freeze({ ok: false as const, message: activation.message });
    return exercisePreparationService.prepare(createExercisePreparationCommand());
  },
});

export async function createAdminExercise(
  userId: string,
  identity: AdminPackageIdentity,
  dependencies: AdminExerciseCreationDependencies = defaultDependencies,
): Promise<string> {
  const selected = dependencies.resolvePackage(identity);
  if (!selected) throw new Error("Valitud õppusepakett pole enam saadaval. Vali pakett uuesti.");
  await dependencies.grantBootstrap(userId);
  await dependencies.refreshSession();
  const result = dependencies.prepare({ packageId: selected.packageId, packageVersion: selected.packageVersion });
  if (!result.ok) throw new Error(result.message);
  if (result.exercisePackage.packageId !== selected.packageId ||
      result.exercisePackage.packageVersion !== selected.packageVersion ||
      result.exercisePackage.packageHash !== selected.packageHash) {
    throw new Error("Loodud õppuse paketisidumine ei vasta valitud paketile.");
  }
  return result.exerciseId;
}
