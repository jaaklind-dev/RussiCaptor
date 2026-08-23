import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";

export type ImportedPatientProcessBinding = Readonly<{
  bindingId: string;
  patientId: string;
  processType: string;
  providerModuleId: string;
  providerVersion: string;
}>;

export type ImportedActionBinding = Readonly<{
  actionId: string;
  definitionId: string;
  providerModuleId: string;
  providerVersion: string;
  scope: "EXERCISE" | "PATIENT" | "PROCESS";
  patientId?: string;
  processType?: string;
  ownerModuleId: string;
}>;

export type ImportedLocationBinding = Readonly<{
  locationId: string;
  code: string;
  name: string;
}>;

export type ImportedRelationshipBinding = Readonly<{
  relationshipId: string;
  sourcePatientId: string;
  targetPatientId: string;
  relationshipType: string;
}>;

export type ImportedExercisePackageArtifacts = Readonly<{
  exercisePackage: ExercisePackage;
  patientDataset: PackagePatientDataset;
  processBindings: readonly ImportedPatientProcessBinding[];
  actionBindings: readonly ImportedActionBinding[];
  locations: readonly ImportedLocationBinding[];
  relationships: readonly ImportedRelationshipBinding[];
}>;

