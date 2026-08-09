import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION } from "@/modules/airway/AirwayManifest";
import { MEDICATION_CORE_MODULE_ID, MEDICATION_CORE_MODULE_VERSION } from "@/modules/medicationCore/MedicationCoreManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const ALS_MODULE_ID = "ALS_V1" as const;
export const ALS_MODULE_VERSION = "1.0.0" as const;

export const alsManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: ALS_MODULE_ID,
  version: ALS_MODULE_VERSION,
  description: "Composition module for existing Advanced Life Support airway and medication capabilities.",
  dependencies: Object.freeze([
    Object.freeze({ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }),
    Object.freeze({ moduleId: MEDICATION_CORE_MODULE_ID, version: MEDICATION_CORE_MODULE_VERSION }),
  ]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
