import type { ImportedExercisePackageArtifacts } from "@/models/import/ImportedExercisePackage";
import { exercisePackageLoader, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { deepFreeze } from "@/utils/immutable";

const key = (id: string, version: string) => `${id}@${version}`;

export class ImportedExercisePackageRegistry {
  private readonly values = new Map<string, { sourceHash: string; artifacts: ImportedExercisePackageArtifacts }>();

  register(artifacts: ImportedExercisePackageArtifacts): ImportedExercisePackageArtifacts {
    const identity = key(artifacts.exercisePackage.packageId, artifacts.exercisePackage.packageVersion);
    const existing = this.values.get(identity);
    if (existing) {
      if (existing.sourceHash !== artifacts.exercisePackage.packageHash) throw new Error(`IMPORTED_PACKAGE_VERSION_CONFLICT:${identity}`);
      return deepFreeze(structuredClone(existing.artifacts)) as ImportedExercisePackageArtifacts;
    }
    packagePatientDatasetRegistry.register(artifacts.patientDataset);
    exercisePackageLoader.load(artifacts.exercisePackage);
    const published = deepFreeze(structuredClone({ ...artifacts, exercisePackage: exercisePackageRegistry.require(artifacts.exercisePackage.packageId, artifacts.exercisePackage.packageVersion) })) as ImportedExercisePackageArtifacts;
    this.values.set(identity, { sourceHash: artifacts.exercisePackage.packageHash, artifacts: published });
    return deepFreeze(structuredClone(published)) as ImportedExercisePackageArtifacts;
  }

  get(packageId: string, packageVersion: string): ImportedExercisePackageArtifacts | undefined {
    const value = this.values.get(key(packageId, packageVersion));
    return value ? deepFreeze(structuredClone(value.artifacts)) as ImportedExercisePackageArtifacts : undefined;
  }
}

export const importedExercisePackageRegistry = new ImportedExercisePackageRegistry();
