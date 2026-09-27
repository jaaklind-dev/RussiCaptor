import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageManifest } from "@/models/exercise/ExercisePackageManifest";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";

const sorted = <T extends string>(values: readonly T[]): T[] => [...values].sort();
const normalizedInterventionAvailability = (value: NonNullable<ExercisePackage["interventionAvailability"]>) => ({
  schemaVersion: value.schemaVersion,
  packageWideResourceInterventionDefinitionIds: sorted(value.packageWideResourceInterventionDefinitionIds),
  ...(value.packageWideSpecializedActions ? { packageWideSpecializedActions: sorted(value.packageWideSpecializedActions) } : {}),
  patients: [...value.patients].map(patient => ({ patientId: patient.patientId,
    allowedResourceInterventionDefinitionIds: sorted(patient.allowedResourceInterventionDefinitionIds),
    ...(patient.allowedSpecializedActions ? { allowedSpecializedActions: sorted(patient.allowedSpecializedActions) } : {}),
  })).sort((left, right) => left.patientId.localeCompare(right.patientId)),
});
export function packageHashInput(input: Omit<ExercisePackage, "packageHash" | "manifest"> & { manifest: Omit<ExercisePackageManifest, "packageHash"> | ExercisePackageManifest }) {
  const { packageHash: _manifestHash, ...manifest } = input.manifest as ExercisePackageManifest;
  return { packageId: input.packageId, packageVersion: input.packageVersion, definition: input.definition,
    patientDatasetId: input.patientDatasetId, enabledPatientProcesses: sorted(input.enabledPatientProcesses),
    enabledAnalyticsProviders: sorted(input.enabledAnalyticsProviders), enabledMetricProviders: sorted(input.enabledMetricProviders),
    metadata: { ...input.metadata, tags: sorted(input.metadata.tags) }, manifest,
    ...(input.requiredClinicalModules ? { requiredClinicalModules: [...input.requiredClinicalModules].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.version.localeCompare(right.version)) } : {}),
    ...(input.protocolConfiguration ? { protocolConfiguration: { ...input.protocolConfiguration } } : {}),
    ...(input.evaluationProfile ? { evaluationProfile: { ...input.evaluationProfile } } : {}),
    ...(input.transportConfiguration ? { transportConfiguration: structuredClone(input.transportConfiguration) } : {}),
    ...(input.availableClinicalTreatments ? {
      availableClinicalTreatments: sorted(input.availableClinicalTreatments),
    } : {}),
    ...(input.imagingConfiguration ? {
      imagingConfiguration: structuredClone(input.imagingConfiguration),
    } : {}),
    ...(input.interventionAvailability ? {
      interventionAvailability: normalizedInterventionAvailability(input.interventionAvailability),
    } : {}),
    ...(input.questionConfiguration ? { questionConfiguration: structuredClone(input.questionConfiguration) } : {}),
    ...(input.internalTransferConfiguration ? { internalTransferConfiguration: structuredClone(input.internalTransferConfiguration) } : {}),
  };
}
export const calculateExercisePackageHash = (input: Parameters<typeof packageHashInput>[0]) => sha256Text(stableJson(packageHashInput(input)));

export function createExercisePackage(input: Omit<ExercisePackage, "packageHash" | "manifest"> & { compatibilityVersion?: number }): ExercisePackage {
  const { compatibilityVersion = 1, ...content } = input;
  const definitionHash = hashExerciseDefinition(content.definition); const manifestBase = { packageId: content.packageId, packageVersion: content.packageVersion, definitionHash, compatibilityVersion };
  const packageHash = calculateExercisePackageHash({ ...content, manifest: manifestBase });
  const value: ExercisePackage = { ...structuredClone(content), enabledPatientProcesses: sorted(content.enabledPatientProcesses), enabledAnalyticsProviders: sorted(content.enabledAnalyticsProviders), enabledMetricProviders: sorted(content.enabledMetricProviders), metadata: { ...structuredClone(content.metadata), tags: sorted(content.metadata.tags) }, ...(content.requiredClinicalModules ? { requiredClinicalModules: [...content.requiredClinicalModules].sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.version.localeCompare(right.version)) } : {}), ...(content.protocolConfiguration ? { protocolConfiguration: { ...content.protocolConfiguration } } : {}), ...(content.evaluationProfile ? { evaluationProfile: { ...content.evaluationProfile } } : {}), ...(content.transportConfiguration ? { transportConfiguration: structuredClone(content.transportConfiguration) } : {}), ...(content.availableClinicalTreatments ? { availableClinicalTreatments: sorted(content.availableClinicalTreatments) } : {}), ...(content.imagingConfiguration ? { imagingConfiguration: structuredClone(content.imagingConfiguration) } : {}), ...(content.interventionAvailability ? { interventionAvailability: normalizedInterventionAvailability(content.interventionAvailability) } : {}), ...(content.questionConfiguration ? { questionConfiguration: structuredClone(content.questionConfiguration) } : {}), ...(content.internalTransferConfiguration ? { internalTransferConfiguration: structuredClone(content.internalTransferConfiguration) } : {}), packageHash, manifest: { ...manifestBase, packageHash } };
  return deepFreeze(value);
}
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value as Record<string, unknown>).forEach(deepFreeze); Object.freeze(value); } return value; }
