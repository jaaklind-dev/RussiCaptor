import type { AdminPackageIdentity } from "@/services/admin/AdminPackageSelectionService";

export type PendingInitialExercisePublication = Readonly<{
  operationId: string;
  exerciseId: string;
  packageIdentity: AdminPackageIdentity;
}>;

let pending: PendingInitialExercisePublication | undefined;

export function beginInitialExercisePublication(
  publication: PendingInitialExercisePublication,
): void {
  if (pending && pending.operationId !== publication.operationId) {
    throw new Error("ADMIN_EXERCISE_CREATE_ALREADY_IN_PROGRESS");
  }
  pending = Object.freeze({
    ...publication,
    packageIdentity: Object.freeze({ ...publication.packageIdentity }),
  });
}

export function finishInitialExercisePublication(operationId: string): void {
  if (pending?.operationId === operationId) pending = undefined;
}

export function getPendingInitialExercisePublication(): PendingInitialExercisePublication | undefined {
  return pending;
}

export function shouldPreservePendingInitialExercise(localExerciseId: string, remoteExerciseId: string): boolean {
  return Boolean(pending && pending.exerciseId === localExerciseId && pending.exerciseId !== remoteExerciseId);
}

export function resetInitialExercisePublicationFenceForTests(): void {
  pending = undefined;
}
