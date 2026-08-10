import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const CARDIAC_ARREST_MODULE_ID = "CARDIAC_ARREST_V1" as const;
export const CARDIAC_ARREST_MODULE_VERSION = "1.0.0" as const;

export const cardiacArrestManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: CARDIAC_ARREST_MODULE_ID,
  version: CARDIAC_ARREST_MODULE_VERSION,
  description: "Canonical cardiac arrest, rhythm, CPR, defibrillation and ROSC foundation.",
  dependencies: Object.freeze([]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
