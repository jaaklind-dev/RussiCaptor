import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION } from "@/modules/airway/AirwayManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const RESPIRATORY_FAILURE_MODULE_ID = "RESPIRATORY_FAILURE_V1" as const;
export const RESPIRATORY_FAILURE_MODULE_VERSION = "1.0.0" as const;

export const respiratoryFailureManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: RESPIRATORY_FAILURE_MODULE_ID,
  version: RESPIRATORY_FAILURE_MODULE_VERSION,
  description: "Existing configurable Respiratory Failure PatientProcess and its unique clinical effect registration.",
  dependencies: Object.freeze([{ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
