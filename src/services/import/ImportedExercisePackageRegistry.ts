import "expo-sqlite/localStorage/install";

import type { ImportedExercisePackageArtifacts } from "@/models/import/ImportedExercisePackage";
import { exercisePackageLoader, exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { deepFreeze } from "@/utils/immutable";

const key = (id: string, version: string) => `${id}@${version}`;
const STORAGE_KEY = "russicaptor.importedExercisePackages.v1";

export type ImportedExercisePackageStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;

const defaultStorage: ImportedExercisePackageStorage = {
  getItem: storageKey => globalThis.localStorage?.getItem(storageKey) ?? null,
  setItem: (storageKey, value) => globalThis.localStorage?.setItem(storageKey, value),
};

export class ImportedExercisePackageRegistry {
  private readonly values = new Map<string, { sourceHash: string; artifacts: ImportedExercisePackageArtifacts }>();
  private restored = false;

  constructor(private readonly storage: ImportedExercisePackageStorage = defaultStorage) {}

  private publish(artifacts: ImportedExercisePackageArtifacts): ImportedExercisePackageArtifacts {
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

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.values.values()].map(value => value.artifacts)));
  }

  register(artifacts: ImportedExercisePackageArtifacts): ImportedExercisePackageArtifacts {
    const before = this.values.size;
    const published = this.publish(artifacts);
    if (this.values.size !== before) this.persist();
    return published;
  }

  /**
   * Replays only packages that already passed the generic importer and were
   * durably stored on this device. Every package and dataset is revalidated by
   * the canonical registries before it becomes available to checkpoint restore.
   */
  restorePersisted(): Readonly<{ restored: number; rejected: number }> {
    if (this.restored) return Object.freeze({ restored: this.values.size, rejected: 0 });
    this.restored = true;
    let parsed: unknown;
    try {
      const serialized = this.storage.getItem(STORAGE_KEY);
      if (!serialized) return Object.freeze({ restored: 0, rejected: 0 });
      parsed = JSON.parse(serialized);
    } catch {
      return Object.freeze({ restored: 0, rejected: 1 });
    }
    if (!Array.isArray(parsed)) return Object.freeze({ restored: 0, rejected: 1 });
    let restored = 0;
    let rejected = 0;
    for (const candidate of parsed) {
      try {
        this.publish(candidate as ImportedExercisePackageArtifacts);
        restored += 1;
      } catch {
        rejected += 1;
      }
    }
    return Object.freeze({ restored, rejected });
  }

  get(packageId: string, packageVersion: string): ImportedExercisePackageArtifacts | undefined {
    const value = this.values.get(key(packageId, packageVersion));
    return value ? deepFreeze(structuredClone(value.artifacts)) as ImportedExercisePackageArtifacts : undefined;
  }
}

export const importedExercisePackageRegistry = new ImportedExercisePackageRegistry();

export function restorePersistedImportedExercisePackages(): Readonly<{ restored: number; rejected: number }> {
  return importedExercisePackageRegistry.restorePersisted();
}
