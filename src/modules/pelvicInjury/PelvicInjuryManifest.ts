import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION } from "@/modules/traumaCore/TraumaCoreManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const PELVIC_INJURY_MODULE_ID = "PELVIC_INJURY_V1" as const;
export const PELVIC_INJURY_MODULE_VERSION = "1.0.0" as const;

export const pelvicInjuryManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: PELVIC_INJURY_MODULE_ID,
  version: PELVIC_INJURY_MODULE_VERSION,
  description: "Open-book pelvic injury configuration using canonical Hemorrhage and pelvic stabilization capabilities.",
  dependencies: Object.freeze([{ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION }]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
