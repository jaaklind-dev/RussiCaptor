import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { getExercisePackage } from "./ExercisePackageService";

export type PatientInterventionAvailabilityProjection = Readonly<{
  packageId: string;
  packageVersion: string;
  patientId: string;
  resourceInterventionDefinitionIds: readonly string[];
  specializedActions: readonly string[];
}>;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)].sort());

export function projectPatientInterventionAvailability(pkg: ExercisePackage,
  patientId: string): PatientInterventionAvailabilityProjection | undefined {
  const contract = pkg.interventionAvailability;
  if (!contract) return undefined;
  const patient = contract.patients.find(item => item.patientId === patientId);
  if (!patient) return Object.freeze({ packageId: pkg.packageId, packageVersion: pkg.packageVersion,
    patientId, resourceInterventionDefinitionIds: Object.freeze([]), specializedActions: Object.freeze([]) });
  return Object.freeze({ packageId: pkg.packageId, packageVersion: pkg.packageVersion, patientId,
    resourceInterventionDefinitionIds: uniqueSorted([
      ...contract.packageWideResourceInterventionDefinitionIds,
      ...patient.allowedResourceInterventionDefinitionIds,
    ]),
    specializedActions: uniqueSorted([
      ...(contract.packageWideSpecializedActions ?? []),
      ...(patient.allowedSpecializedActions ?? []),
    ]),
  });
}

export function isResourceInterventionAllowed(exerciseId: string, patientId: string,
  definitionId: string): boolean {
  const projection = projectPatientInterventionAvailability(getExercisePackage(exerciseId), patientId);
  // Packages without the new contract preserve their established behavior.
  return projection === undefined || projection.resourceInterventionDefinitionIds.includes(definitionId);
}
