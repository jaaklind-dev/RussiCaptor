import type { AnalyticsReport } from "@/models/analytics/Analytics";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";

/** Adds read-only provenance after canonical analytics hashing. */
export function withExercisePackageMetadata(report: AnalyticsReport, pkg: Pick<ExercisePackage, "packageId" | "packageVersion" | "packageHash">): AnalyticsReport {
  return Object.freeze({ ...report, exercisePackage: Object.freeze({ packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageHash: pkg.packageHash }) });
}
