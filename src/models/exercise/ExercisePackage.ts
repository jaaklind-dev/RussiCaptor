import type { ExerciseDefinition } from "./ExerciseDefinition";
import type { ExercisePackageManifest } from "./ExercisePackageManifest";
import type { PackageMetadata } from "./PackageMetadata";
import type { ClinicalModuleDependency } from "@/models/clinical/ClinicalModuleDependency";
import type { ProtocolReference } from "@/models/protocol/ClinicalProtocolConfiguration";
import type { EvaluationProfileReference } from "@/models/evaluation/ExerciseEvaluation";

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
  requiredClinicalModules?: readonly ClinicalModuleDependency[];
  protocolConfiguration?: ProtocolReference;
  evaluationProfile?: EvaluationProfileReference;
}>;
