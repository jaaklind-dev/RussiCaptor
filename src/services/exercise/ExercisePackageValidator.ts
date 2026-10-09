import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { validateImagingAssetReference } from "@/services/imaging/ImagingAssetRegistry";
import type { ExercisePackageCompatibility } from "@/models/exercise/ExercisePackageManifest";
import type { ExerciseDefinitionCatalog } from "@/models/exercise/ExerciseDefinition";
import { calculateExercisePackageHash } from "./ExercisePackageHash";
import { hashExerciseDefinition } from "./ExerciseDefinitionRegistry";
import { ExerciseDefinitionValidator } from "./ExerciseDefinitionValidator";
import { isClinicalTreatmentId } from "@/services/clinical/ClinicalTreatmentCatalog";
import { NARVA_LAB_ANALYTES, NARVA_LAB_PACKAGE_ANALYTE_IDS } from "@/config/NarvaLaboratoryCatalog";
import type { LabResultGroupType } from "@/models/LaboratoryWorkflow";

export const CURRENT_PACKAGE_COMPATIBILITY_VERSION = 1;
export type ExercisePackageValidationCode = "INVALID_PACKAGE_ID" | "INVALID_PACKAGE_VERSION" | "INVALID_MANIFEST" | "INVALID_HASH" | "INVALID_DEFINITION" | "UNKNOWN_PATIENT_PROCESS" | "UNKNOWN_ANALYTICS_PROVIDER" | "UNKNOWN_METRIC_PROVIDER" | "INCONSISTENT_SELECTION" | "DUPLICATE_VALUE" | "INCOMPATIBLE_PACKAGE" | "INVALID_MODULE_DEPENDENCY" | "INVALID_EVALUATION_PROFILE_REFERENCE" | "INVALID_TRANSPORT_CONFIGURATION" | "INVALID_CLINICAL_TREATMENT" | "INVALID_IMAGING_CONFIGURATION" | "INVALID_LABORATORY_CONFIGURATION" | "INVALID_INTERVENTION_AVAILABILITY" | "INVALID_QUESTION_CONFIGURATION";
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
    const treatments = pkg.availableClinicalTreatments;
    if (treatments) {
      for (const treatmentId of [...new Set(duplicates(treatments))].sort()) {
        add("DUPLICATE_VALUE", "availableClinicalTreatments", `Duplicate treatment ${treatmentId}`);
      }
      treatments.filter(treatmentId => !isClinicalTreatmentId(treatmentId)).forEach(treatmentId =>
        add("INVALID_CLINICAL_TREATMENT", "availableClinicalTreatments", `Unknown treatment ${treatmentId}`));
    }
    const availability = pkg.interventionAvailability;
    if (availability) {
      if (availability.schemaVersion !== 1) add("INVALID_INTERVENTION_AVAILABILITY",
        "interventionAvailability.schemaVersion", "Unsupported intervention availability schema version");
      const packageWide = availability.packageWideResourceInterventionDefinitionIds;
      if (duplicates(packageWide).length) add("DUPLICATE_VALUE",
        "interventionAvailability.packageWideResourceInterventionDefinitionIds", "Duplicate package-wide intervention definition");
      const patientIds = availability.patients.map(item => item.patientId);
      if (duplicates(patientIds).length) add("DUPLICATE_VALUE", "interventionAvailability.patients",
        "Duplicate patient intervention availability");
      availability.patients.forEach((patient, index) => {
        if (!patient.patientId.trim()) add("INVALID_INTERVENTION_AVAILABILITY",
          `interventionAvailability.patients[${index}].patientId`, "Patient identity is required");
        if (duplicates(patient.allowedResourceInterventionDefinitionIds).length) add("DUPLICATE_VALUE",
          `interventionAvailability.patients[${index}].allowedResourceInterventionDefinitionIds`,
          "Duplicate patient intervention definition");
        if (patient.allowedResourceInterventionDefinitionIds.some(id => packageWide.includes(id))) {
          add("INVALID_INTERVENTION_AVAILABILITY",
            `interventionAvailability.patients[${index}].allowedResourceInterventionDefinitionIds`,
            "Patient-specific definitions must not duplicate package-wide definitions");
        }
      });
    }
    if (pkg.evaluationProfile && (!pkg.evaluationProfile.profileId?.trim() || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.evaluationProfile.version))) add("INVALID_EVALUATION_PROFILE_REFERENCE", "evaluationProfile", "Evaluation Profile requires an ID and exact semantic version");
    if (pkg.evaluationProfile && !pkg.protocolConfiguration) add("INVALID_EVALUATION_PROFILE_REFERENCE", "evaluationProfile", "Evaluation Profile requires an exact Protocol binding");
    const transport = pkg.transportConfiguration;
    if (transport) {
      if (!transport.version?.trim() || !transport.vehicleLocationId?.trim()) add("INVALID_TRANSPORT_CONFIGURATION", "transportConfiguration", "Transport configuration requires a version and vehicle location");
      const resourceIds = transport.resources.map(item => item.resourceId); const destinationIds = transport.destinations.map(item => item.destinationId);
      if (new Set(resourceIds).size !== resourceIds.length || transport.resources.some(item => !item.resourceId?.trim() || !item.resourceType?.trim() || !item.displayName?.trim() || !item.homeLocationId?.trim() || item.capacity !== 1)) add("INVALID_TRANSPORT_CONFIGURATION", "transportConfiguration.resources", "Transport resources require unique identity, home location and capacity one");
      if (new Set(destinationIds).size !== destinationIds.length || transport.destinations.some(item => !item.destinationId?.trim() || !item.displayName?.trim() || [item.travelDurationSec, item.handoverDurationSec, item.returnDurationSec, item.turnaroundDurationSec].some(value => !Number.isInteger(value) || value < 0))) add("INVALID_TRANSPORT_CONFIGURATION", "transportConfiguration.destinations", "Transport destinations require unique identity and non-negative canonical durations");
    }
    const imaging = pkg.imagingConfiguration;
    if (imaging) {
      if (imaging.schemaVersion !== 1) add("INVALID_IMAGING_CONFIGURATION", "imagingConfiguration.schemaVersion", "Unsupported Imaging configuration schema version");
      const studyIds = imaging.definitions.map(item => item.study.id);
      const orderIds = imaging.definitions.map(item => item.order.id);
      if (new Set(studyIds).size !== studyIds.length) add("DUPLICATE_VALUE", "imagingConfiguration.definitions", "Duplicate Imaging study ID");
      if (new Set(orderIds).size !== orderIds.length) add("DUPLICATE_VALUE", "imagingConfiguration.definitions", "Duplicate Imaging order ID");
      imaging.definitions.forEach((item, index) => {
        const path = `imagingConfiguration.definitions[${index}]`;
        if (!item.study.id?.trim() || !item.study.patientId?.trim() || !item.study.title?.trim() || !item.study.report?.trim()) add("INVALID_IMAGING_CONFIGURATION", path, "Imaging study identity, patient, title and report are required");
        if (item.study.attachment) add("INVALID_IMAGING_CONFIGURATION", `${path}.study.attachment`, "Package Imaging must use the canonical asset reference contract");
        if (item.study.asset) {
          try {
            validateImagingAssetReference(item.study.asset);
            if (!item.study.asset.packageVersion || !item.study.asset.patientId ||
              item.study.asset.packageId !== pkg.packageId || item.study.asset.packageVersion !== pkg.packageVersion ||
              item.study.asset.patientId !== item.study.patientId || item.study.asset.definitionId !== item.study.id) {
              add("INVALID_IMAGING_CONFIGURATION", `${path}.study.asset`, "Imaging asset provenance must match package and definition");
            }
          } catch {
            add("INVALID_IMAGING_CONFIGURATION", `${path}.study.asset`, "Imaging asset identity or integrity metadata is invalid");
          }
        }
        if (!item.order.id?.trim() || !item.order.title?.trim()) add("INVALID_IMAGING_CONFIGURATION", `${path}.order`, "Imaging order identity and title are required");
        if (item.order.workflow.resultAction !== "imaging.available" || item.order.workflow.resultTargetId !== item.study.id || !Number.isFinite(item.order.workflow.delayMinutes) || item.order.workflow.delayMinutes < 0) add("INVALID_IMAGING_CONFIGURATION", `${path}.order.workflow`, "Imaging order must target its study with a non-negative delay");
      });
    }
    const laboratory = pkg.laboratoryConfiguration;
    if (laboratory) {
      const eligible = NARVA_LAB_PACKAGE_ANALYTE_IDS[laboratory.catalogPackageId];
      if (laboratory.schemaVersion !== 1 || !eligible) add("INVALID_LABORATORY_CONFIGURATION", "laboratoryConfiguration", "Unsupported laboratory catalog binding");
      const patientIds = laboratory.patients.map(item => item.patientId);
      if (duplicates(patientIds).length) add("DUPLICATE_VALUE", "laboratoryConfiguration.patients", "Duplicate patient laboratory configuration");
      for (const [index, patient] of laboratory.patients.entries()) {
        if (!patient.patientId.trim()) add("INVALID_LABORATORY_CONFIGURATION", `laboratoryConfiguration.patients[${index}].patientId`, "Patient ID is required");
        for (const [analyteId, value] of Object.entries(patient.initialResults)) {
          const analyte = NARVA_LAB_ANALYTES.find(item => item.id === analyteId);
          if (!eligible?.includes(analyteId) || !analyte || analyte.reportable === false ||
            !["STATIC_BASELINE", "DEMOGRAPHIC_CONDITIONAL"].includes(analyte.implementationClass) ||
            !(typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.trim().length > 0)) {
            add("INVALID_LABORATORY_CONFIGURATION", `laboratoryConfiguration.patients[${index}].initialResults.${analyteId}`, "Only finite static catalog values may be authored");
          }
        }
      }
      const groups = new Set<LabResultGroupType>(["ASTRUP", "HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"]);
      for (const [group, seconds] of Object.entries(laboratory.resultDelaySeconds ?? {})) {
        if (!groups.has(group as LabResultGroupType) || !Number.isInteger(seconds) || seconds < 0) add("INVALID_LABORATORY_CONFIGURATION", `laboratoryConfiguration.resultDelaySeconds.${group}`, "Delay must be a non-negative number of simulation seconds");
      }
    }
    const questions = pkg.questionConfiguration;
    if (questions) {
      if (questions.schemaVersion !== 1) add("INVALID_QUESTION_CONFIGURATION",
        "questionConfiguration.schemaVersion", "Unsupported question configuration schema version");
      const ids = questions.definitions.map(item => item.questionId);
      if (duplicates(ids).length) add("DUPLICATE_VALUE", "questionConfiguration.definitions",
        "Duplicate package question identity");
      questions.definitions.forEach((item, index) => {
        const path = `questionConfiguration.definitions[${index}]`;
        if (!item.questionId.trim() || !item.patientId.trim() || !item.sourcePatientId.trim() ||
          !item.category.trim() || !item.prompt.trim() || !item.answer.trim() ||
          !Number.isInteger(item.order) || item.order < 1 || item.visibility !== "hidden") {
          add("INVALID_QUESTION_CONFIGURATION", path,
            "Package questions require source identity, patient, content, positive order and hidden initial visibility");
        }
      });
      const patientOrders = questions.definitions.map(item => `${item.patientId}\0${item.order}`);
      if (duplicates(patientOrders).length) add("DUPLICATE_VALUE", "questionConfiguration.definitions",
        "Question order must be unique within each patient");
    }
    return Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)));
  }
  assertValid(pkg: ExercisePackage): void { const issues = this.validate(pkg); if (issues.length) throw new Error(`INVALID_EXERCISE_PACKAGE:${issues.map(issue => `${issue.code}@${issue.path}`).join(",")}`); }
}
