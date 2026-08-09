import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const MEDICATION_CORE_MODULE_ID = "MEDICATION_CORE_V1" as const;
export const MEDICATION_CORE_MODULE_VERSION = "1.0.0" as const;

export const medicationCoreManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: MEDICATION_CORE_MODULE_ID,
  version: MEDICATION_CORE_MODULE_VERSION,
  description: "Existing configuration-driven medication lifecycle and assessment hooks.",
  dependencies: Object.freeze([]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
