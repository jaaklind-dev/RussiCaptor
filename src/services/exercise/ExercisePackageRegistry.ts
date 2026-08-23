import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { ExercisePackageValidator } from "./ExercisePackageValidator";

const key = (id: string, version: string) => `${id}@${version}`;
const semver = (value: string) => value.split(/[.-]/).map(part => Number(part) || 0);
const compareVersion = (a: string, b: string) => { const left = semver(a), right = semver(b); for (let index = 0; index < Math.max(left.length, right.length); index += 1) { const result = (left[index] ?? 0) - (right[index] ?? 0); if (result) return result; } return a.localeCompare(b); };
export class ExercisePackageRegistry {
  private readonly values = new Map<string, ExercisePackage>();
  constructor(private readonly validator: ExercisePackageValidator) {}
  register(pkg: ExercisePackage): void { this.validator.assertValid(pkg); const id = key(pkg.packageId, pkg.packageVersion); const existing = this.values.get(id); if (existing) { if (existing.packageHash !== pkg.packageHash) throw new Error(`EXERCISE_PACKAGE_VERSION_CONFLICT:${id}`); return; } this.values.set(id, pkg); }
  get(packageId: string, packageVersion: string): ExercisePackage | undefined { return this.values.get(key(packageId, packageVersion)); }
  require(packageId: string, packageVersion: string): ExercisePackage { const pkg = this.get(packageId, packageVersion); if (!pkg) throw new Error(`UNKNOWN_EXERCISE_PACKAGE:${key(packageId, packageVersion)}`); return pkg; }
  latest(packageId: string): ExercisePackage | undefined { return this.packages.filter(pkg => pkg.packageId === packageId).at(-1); }
  get packages(): readonly ExercisePackage[] { return Object.freeze([...this.values.values()].sort((a, b) => a.packageId.localeCompare(b.packageId) || compareVersion(a.packageVersion, b.packageVersion))); }
}
