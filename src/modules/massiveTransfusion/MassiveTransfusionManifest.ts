import type { ClinicalModuleManifest } from "@/models/clinical/ClinicalModuleManifest";
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION } from "@/modules/traumaCore/TraumaCoreManifest";
import { CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION } from "@/services/clinical/ClinicalModuleRegistry";
export const MASSIVE_TRANSFUSION_MODULE_ID = "MASSIVE_TRANSFUSION_V1" as const;
export const MASSIVE_TRANSFUSION_MODULE_VERSION = "1.0.0" as const;
export const massiveTransfusionManifest: ClinicalModuleManifest = Object.freeze({ moduleId: MASSIVE_TRANSFUSION_MODULE_ID, version: MASSIVE_TRANSFUSION_MODULE_VERSION,
  description: "Deterministic blood-product resuscitation with finite inventory, administration time, volume replacement and RBC capacity.",
  dependencies: Object.freeze([{ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION }]), compatibilityVersion: CURRENT_CLINICAL_MODULE_COMPATIBILITY_VERSION });
