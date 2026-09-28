import type { ImagingAssetReference } from "@/models/ImagingAsset";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageLoader } from "@/services/exercise/ExercisePackageLoader";
import type { ExercisePackageRegistry } from "@/services/exercise/ExercisePackageRegistry";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { getRegisteredImagingAsset } from "./ImagingAssetRegistry";
import { GENERATED_IMAGING_AUTHORED_PACKAGE_RECIPES } from "./ImagingAuthoredPackageVersions.generated";

export type ImagingAuthoredPackageRecipe = Readonly<{
  packageId: string;
  baseVersion: string;
  basePackageHash: string;
  newVersion: string;
  patientId: string;
  definitionId: string;
  assetId: string;
  expectedPackageHash: string;
}>;

const clonePackageWithAsset = (
  base: ExercisePackage,
  recipe: ImagingAuthoredPackageRecipe,
  asset: ImagingAssetReference,
): ExercisePackage => {
  if (base.packageId !== recipe.packageId || base.packageVersion !== recipe.baseVersion ||
    base.packageHash !== recipe.basePackageHash) throw new Error("IMAGING_AUTHOR_BASE_PACKAGE_DRIFT");
  if (asset.packageId !== recipe.packageId || asset.packageVersion !== recipe.newVersion ||
    asset.patientId !== recipe.patientId || asset.definitionId !== recipe.definitionId) {
    throw new Error("IMAGING_AUTHOR_ASSET_PROVENANCE_MISMATCH");
  }
  const imaging = base.imagingConfiguration;
  if (!imaging) throw new Error("IMAGING_AUTHOR_PACKAGE_HAS_NO_IMAGING");
  const matching = imaging.definitions.filter(item => item.study.id === recipe.definitionId &&
    item.study.patientId === recipe.patientId);
  if (matching.length !== 1) throw new Error("IMAGING_AUTHOR_TARGET_NOT_UNIQUE");
  if (matching[0].study.asset?.assetId === asset.assetId) {
    throw new Error("IMAGING_AUTHOR_REPLACEMENT_REQUIRES_NEW_ASSET_IDENTITY");
  }
  const imagingConfiguration = {
    schemaVersion: 1 as const,
    definitions: imaging.definitions.map(item => item.study.id === recipe.definitionId &&
      item.study.patientId === recipe.patientId
      ? { study: { ...structuredClone(item.study), asset: structuredClone(asset) },
        order: structuredClone(item.order) }
      : structuredClone(item)),
  };
  const authored = createExercisePackage({
    packageId: base.packageId,
    packageVersion: recipe.newVersion,
    definition: base.definition,
    patientDatasetId: base.patientDatasetId,
    enabledPatientProcesses: base.enabledPatientProcesses,
    enabledAnalyticsProviders: base.enabledAnalyticsProviders,
    enabledMetricProviders: base.enabledMetricProviders,
    metadata: base.metadata,
    requiredClinicalModules: base.requiredClinicalModules,
    protocolConfiguration: base.protocolConfiguration,
    evaluationProfile: base.evaluationProfile,
    transportConfiguration: base.transportConfiguration,
    availableClinicalTreatments: base.availableClinicalTreatments,
    imagingConfiguration,
    interventionAvailability: base.interventionAvailability,
    questionConfiguration: base.questionConfiguration,
    internalTransferConfiguration: base.internalTransferConfiguration,
    compatibilityVersion: base.manifest.compatibilityVersion,
  });
  if (recipe.expectedPackageHash && authored.packageHash !== recipe.expectedPackageHash) {
    throw new Error("IMAGING_AUTHOR_PACKAGE_HASH_DRIFT");
  }
  return authored;
};

export function createImagingAuthoredPackage(
  base: ExercisePackage,
  recipe: ImagingAuthoredPackageRecipe,
  asset: ImagingAssetReference,
): ExercisePackage {
  return clonePackageWithAsset(base, recipe, asset);
}

export function loadImagingAuthoredPackageRecipes(
  recipes: readonly ImagingAuthoredPackageRecipe[],
  loader: ExercisePackageLoader,
  registry: ExercisePackageRegistry,
  resolveAsset: (assetId: string) => ImagingAssetReference | undefined = getRegisteredImagingAsset,
): readonly ExercisePackage[] {
  for (const recipe of recipes) {
    if (registry.get(recipe.packageId, recipe.newVersion)) {
      throw new Error(`IMAGING_AUTHOR_PACKAGE_VERSION_CONFLICT:${recipe.packageId}@${recipe.newVersion}`);
    }
  }
  const pending = [...recipes];
  const loaded: ExercisePackage[] = [];
  while (pending.length) {
    const index = pending.findIndex(recipe => Boolean(registry.get(recipe.packageId, recipe.baseVersion)));
    if (index < 0) {
      const unresolved = pending.map(recipe => `${recipe.packageId}@${recipe.baseVersion}`).join(",");
      throw new Error(`IMAGING_AUTHOR_BASE_PACKAGE_CHAIN_UNRESOLVED:${unresolved}`);
    }
    const [recipe] = pending.splice(index, 1);
    const base = registry.require(recipe.packageId, recipe.baseVersion);
    const asset = resolveAsset(recipe.assetId);
    if (!asset) throw new Error(`IMAGING_AUTHOR_ASSET_NOT_REGISTERED:${recipe.assetId}`);
    loaded.push(loader.load(clonePackageWithAsset(base, recipe, asset)));
  }
  return loaded;
}

export function loadGeneratedImagingAuthoredPackages(
  loader: ExercisePackageLoader,
  registry: ExercisePackageRegistry,
): readonly ExercisePackage[] {
  return loadImagingAuthoredPackageRecipes(GENERATED_IMAGING_AUTHORED_PACKAGE_RECIPES, loader, registry);
}
