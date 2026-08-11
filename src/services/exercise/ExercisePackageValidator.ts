import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageCompatibility } from "@/models/exercise/ExercisePackageManifest";
import type { ExerciseDefinitionCatalog } from "@/models/exercise/ExerciseDefinition";
import { calculateExercisePackageHash } from "./ExercisePackageHash";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";
import { ExerciseDefinitionValidator } from "./ExerciseDefinitionValidator";

export const CURRENT_PACKAGE_COMPATIBILITY_VERSION = 1;
export type ExercisePackageValidationCode = "INVALID_PACKAGE_ID" | "INVALID_PACKAGE_VERSION" | "INVALID_MANIFEST" | "INVALID_HASH" | "INVALID_DEFINITION" | "UNKNOWN_PATIENT_PROCESS" | "UNKNOWN_ANALYTICS_PROVIDER" | "UNKNOWN_METRIC_PROVIDER" | "INCONSISTENT_SELECTION" | "DUPLICATE_VALUE" | "INCOMPATIBLE_PACKAGE" | "INVALID_MODULE_DEPENDENCY" | "INVALID_EVALUATION_PROFILE_REFERENCE";
export type ExercisePackageDiagnostic = Readonly<{ code: ExercisePackageValidationCode; path: string; message: string }>;
const duplicates = (values: readonly string[]) => values.filter((value, index) => values.indexOf(value) !== index);

export class ExercisePackageValidator {
  private readonly definitionValidator: ExerciseDefinitionValidator;
  constructor(private readonly catalog: ExerciseDefinitionCatalog) { this.definitionValidator = new ExerciseDefinitionValidator(catalog); }
  compatibility(pkg: ExercisePackage): ExercisePackageCompatibility { const version = pkg.manifest.compatibilityVersion; return version === CURRENT_PACKAGE_COMPATIBILITY_VERSION ? "SUPPORTED" : version >= 0 && version < CURRENT_PACKAGE_COMPATIBILITY_VERSION ? "LEGACY" : "INCOMPATIBLE"; }
  validate(pkg: ExercisePackage): readonly ExercisePackageDiagnostic[] {
    const issues: ExercisePackageDiagnostic[] = []; const add = (code: ExercisePackageValidationCode, path: string, message: string) => issues.push(Object.freeze({ code, path, message }));
    if (!pkg.packageId?.trim()) add("INVALID_PACKAGE_ID", "packageId", "Package ID is required");
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.packageVersion)) add("INVALID_PACKAGE_VERSION", "packageVersion", "Package version must use semantic versioning");
    if (pkg.manifest.packageId !== pkg.packageId || pkg.manifest.packageVersion !== pkg.packageVersion) add("INVALID_MANIFEST", "manifest", "Manifest identity must match package identity");
    if (pkg.manifest.definitionHash !== hashExerciseDefinition(pkg.definition)) add("INVALID_MANIFEST", "manifest.definitionHash", "Definition hash mismatch");
    if (pkg.manifest.packageHash !== pkg.packageHash || calculateExercisePackageHash(pkg) !== pkg.packageHash) add("INVALID_HASH", "packageHash", "Package hash mismatch");
    if (this.compatibility(pkg) === "INCOMPATIBLE") add("INCOMPATIBLE_PACKAGE", "manifest.compatibilityVersion", "Package compatibility version is not supported");
    for (const issue of this.definitionValidator.validate(pkg.definition)) add("INVALID_DEFINITION", `definition.${issue.path}`, issue.message);
    const groups = [["enabledPatientProcesses", pkg.enabledPatientProcesses], ["enabledAnalyticsProviders", pkg.enabledAnalyticsProviders], ["enabledMetricProviders", pkg.enabledMetricProviders]] as const;
    for (const [path, values] of groups) for (const value of [...new Set(duplicates(values))].sort()) add("DUPLICATE_VALUE", path, `Duplicate value ${value}`);
    for (const value of pkg.enabledPatientProcesses.filter(value => !this.catalog.patientProcesses.includes(value))) add("UNKNOWN_PATIENT_PROCESS", "enabledPatientProcesses", `Unknown PatientProcess ${value}`);
    for (const value of pkg.enabledAnalyticsProviders.filter(value => !this.catalog.analyticsProviders.includes(value))) add("UNKNOWN_ANALYTICS_PROVIDER", "enabledAnalyticsProviders", `Unknown analytics provider ${value}`);
    for (const value of pkg.enabledMetricProviders.filter(value => !this.catalog.metricProviders.includes(value))) add("UNKNOWN_METRIC_PROVIDER", "enabledMetricProviders", `Unknown metric provider ${value}`);
    for (const [path, left, right] of [["enabledPatientProcesses", pkg.enabledPatientProcesses, pkg.definition.enabledPatientProcesses], ["enabledAnalyticsProviders", pkg.enabledAnalyticsProviders, pkg.definition.enabledAnalyticsProviders], ["enabledMetricProviders", pkg.enabledMetricProviders, pkg.definition.enabledMetricProviders]] as const) if ([...left].sort().join("\0") !== [...right].sort().join("\0")) add("INCONSISTENT_SELECTION", path, `${path} must match the Exercise Definition`);
    const moduleDependencies = pkg.requiredClinicalModules ?? [];
    moduleDependencies.forEach((dependency, index) => { if (!dependency.moduleId?.trim() || !/^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(dependency.version)) add("INVALID_MODULE_DEPENDENCY", `requiredClinicalModules[${index}]`, "Clinical Module dependency requires an ID and explicit version"); });
    for (const moduleId of [...new Set(duplicates(moduleDependencies.map(item => item.moduleId)))].sort()) add("DUPLICATE_VALUE", "requiredClinicalModules", `Duplicate Clinical Module ${moduleId}`);
    if (pkg.evaluationProfile && (!pkg.evaluationProfile.profileId?.trim() || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.evaluationProfile.version))) add("INVALID_EVALUATION_PROFILE_REFERENCE", "evaluationProfile", "Evaluation Profile requires an ID and exact semantic version");
    if (pkg.evaluationProfile && !pkg.protocolConfiguration) add("INVALID_EVALUATION_PROFILE_REFERENCE", "evaluationProfile", "Evaluation Profile requires an exact Protocol binding");
    return Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)));
  }
  assertValid(pkg: ExercisePackage): void { const issues = this.validate(pkg); if (issues.length) throw new Error(`INVALID_EXERCISE_PACKAGE:${issues.map(issue => `${issue.code}@${issue.path}`).join(",")}`); }
}
