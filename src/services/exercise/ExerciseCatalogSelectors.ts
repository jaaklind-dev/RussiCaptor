import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageCompatibility } from "@/models/exercise/ExercisePackageManifest";
import type { ExerciseProfile } from "@/models/exercise/ExerciseProfile";

export type ExerciseCatalogEntry = Readonly<{
  exercisePackage: ExercisePackage;
  compatibility: ExercisePackageCompatibility;
}>;

export type ExerciseCatalogFilters = Readonly<{
  search: string;
  profile?: ExerciseProfile;
  compatibility?: ExercisePackageCompatibility;
  tag?: string;
}>;

function compareVersion(left: string, right: string): number {
  const a = left.split(/[.-]/).map(part => Number(part) || 0);
  const b = right.split(/[.-]/).map(part => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

export function compareCatalogEntries(left: ExerciseCatalogEntry, right: ExerciseCatalogEntry): number {
  return left.exercisePackage.metadata.name.localeCompare(right.exercisePackage.metadata.name)
    || compareVersion(left.exercisePackage.packageVersion, right.exercisePackage.packageVersion)
    || left.exercisePackage.packageId.localeCompare(right.exercisePackage.packageId);
}

export function filterExerciseCatalog(
  entries: readonly ExerciseCatalogEntry[],
  filters: ExerciseCatalogFilters,
): readonly ExerciseCatalogEntry[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return Object.freeze(entries.filter(({ exercisePackage: pkg, compatibility }) => {
    if (filters.profile && pkg.definition.profile !== filters.profile) return false;
    if (filters.compatibility && compatibility !== filters.compatibility) return false;
    if (filters.tag && !pkg.metadata.tags.includes(filters.tag)) return false;
    if (!query) return true;
    return [pkg.metadata.name, pkg.metadata.description, pkg.metadata.author, pkg.metadata.organization, ...pkg.metadata.tags]
      .some(value => value.toLocaleLowerCase().includes(query));
  }).sort(compareCatalogEntries));
}

export function listExerciseCatalogTags(entries: readonly ExerciseCatalogEntry[]): readonly string[] {
  return Object.freeze([...new Set(entries.flatMap(entry => entry.exercisePackage.metadata.tags))].sort((a, b) => a.localeCompare(b)));
}
