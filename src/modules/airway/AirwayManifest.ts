import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const AIRWAY_MODULE_ID = "AIRWAY_V1" as const;
export const AIRWAY_MODULE_VERSION = "1.0.0" as const;

export const airwayManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: AIRWAY_MODULE_ID,
  version: AIRWAY_MODULE_VERSION,
  description: "Existing RussiCaptor airway interventions, effects and intervention metrics.",
  dependencies: Object.freeze([]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
