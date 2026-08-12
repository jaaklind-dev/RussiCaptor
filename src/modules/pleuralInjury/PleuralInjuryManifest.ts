import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION } from "@/modules/traumaCore/TraumaCoreManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";

export const PLEURAL_INJURY_MODULE_ID = "PLEURAL_INJURY_V1" as const;
export const PLEURAL_INJURY_MODULE_VERSION = "1.0.0" as const;
export const pleuralInjuryManifest: ClinicalModuleManifest = Object.freeze({
  moduleId: PLEURAL_INJURY_MODULE_ID,
  version: PLEURAL_INJURY_MODULE_VERSION,
  description: "Massive hemopneumothorax composition using canonical pleural, respiratory and thoracic hemorrhage capabilities.",
  dependencies: Object.freeze([{ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION }]),
  compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION,
});
