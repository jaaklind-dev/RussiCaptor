import { getExercisePackage } from "@/services/exercise/ExercisePackageService";

/**
 * A package-owned transfer controls the patient's current location until its
 * durable action materializes. Claim/assignment flows must not compete with
 * that authority.
 */
export function getPackageOwnedLocationTransitions(
  exerciseId: string,
  patientId: string,
  currentLocationId: string
) {
  return (getExercisePackage(exerciseId).internalTransferConfiguration?.definitions ?? [])
    .filter(definition => definition.patientId === patientId &&
      definition.fromLocationId === currentLocationId);
}

export function hasPackageOwnedLocationAuthority(
  exerciseId: string,
  patientId: string,
  currentLocationId: string
): boolean {
  return getPackageOwnedLocationTransitions(exerciseId, patientId, currentLocationId).length > 0;
}
