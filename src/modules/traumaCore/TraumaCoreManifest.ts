import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const TRAUMA_CORE_MODULE_ID = "TRAUMA_CORE_V1" as const;
export const TRAUMA_CORE_MODULE_VERSION = "1.0.0" as const;

export const traumaCoreManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: TRAUMA_CORE_MODULE_ID,
  version: TRAUMA_CORE_MODULE_VERSION,
  description: "Trauma context and immutable injury identity foundation; no injury physiology or treatment effect.",
  dependencies: Object.freeze([]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
