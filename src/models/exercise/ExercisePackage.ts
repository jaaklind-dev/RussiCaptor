import type { ExerciseDefinition } from "./ExerciseDefinition";
import type { ExercisePackageManifest } from "./ExercisePackageManifest";
import type { PackageMetadata } from "./PackageMetadata";
import type { ClinicalModuleDependency } from "@/models/clinical/ClinicalModuleDependency";
import type { ProtocolReference } from "@/models/protocol/ClinicalProtocolConfiguration";
import type { EvaluationProfileReference } from "@/models/evaluation/ExerciseEvaluation";
import type { TransportConfiguration } from "@/models/PatientTransport";
import type { ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { PackageImagingConfiguration } from "./PackageImagingConfiguration";

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
  transportConfiguration?: TransportConfiguration;
  /** Clinical capability palette, not an authorization grant. Omission preserves the historical global palette. */
  availableClinicalTreatments?: readonly ClinicalTreatmentId[];
  /** Predefined Imaging content owned by this exact package version. */
  imagingConfiguration?: PackageImagingConfiguration;
}>;
