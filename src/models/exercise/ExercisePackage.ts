import type { ExerciseDefinition } from "./ExerciseDefinition";
import type { ExercisePackageManifest } from "./ExercisePackageManifest";
import type { PackageMetadata } from "./PackageMetadata";

export type ExercisePackage = Readonly<{
  packageId: string;
  packageVersion: string;
  packageHash: string;
  definition: ExerciseDefinition;
  patientDatasetId: string;
  enabledPatientProcesses: readonly string[];
  enabledAnalyticsProviders: readonly string[];
  enabledMetricProviders: readonly string[];
  metadata: PackageMetadata;
  manifest: ExercisePackageManifest;
}>;
