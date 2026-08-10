import { AIRWAY_MODULE_ID } from "@/modules/airway/AirwayManifest";
import { MEDICATION_CORE_MODULE_ID } from "@/modules/medicationCore/MedicationCoreManifest";
import { CARDIAC_ARREST_MODULE_ID } from "@/modules/cardiacArrest/CardiacArrestManifest";

export type AlsCapabilityStatus = Readonly<{
  capabilityId: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  sourceModuleId?: string;
  reason?: string;
}>;

export type AlsCapabilityAuditFinding = Readonly<{
  capabilityId: "CARDIAC_ARREST" | "RHYTHM_STATE" | "CPR" | "DEFIBRILLATION" | "ROSC";
  classification: "EXISTING_CANONICAL" | "PARTIAL" | "NOT_IMPLEMENTED";
  reason: string;
}>;

export const ALS_CAPABILITY_STATUS: readonly AlsCapabilityStatus[] = Object.freeze([
  Object.freeze({ capabilityId: "BAG_VALVE_MASK_VENTILATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "CARDIAC_ARREST", status: "AVAILABLE", sourceModuleId: CARDIAC_ARREST_MODULE_ID }),
  Object.freeze({ capabilityId: "CPR_PHYSIOLOGY", status: "AVAILABLE", sourceModuleId: CARDIAC_ARREST_MODULE_ID }),
  Object.freeze({ capabilityId: "DEFIBRILLATION", status: "AVAILABLE", sourceModuleId: CARDIAC_ARREST_MODULE_ID }),
  Object.freeze({ capabilityId: "ENDOTRACHEAL_INTUBATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "MECHANICAL_VENTILATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "MEDICATION_ADMINISTRATION", status: "AVAILABLE", sourceModuleId: MEDICATION_CORE_MODULE_ID }),
  Object.freeze({ capabilityId: "OXYGEN_THERAPY", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "RHYTHM_STATE", status: "AVAILABLE", sourceModuleId: CARDIAC_ARREST_MODULE_ID }),
  Object.freeze({ capabilityId: "ROSC", status: "AVAILABLE", sourceModuleId: CARDIAC_ARREST_MODULE_ID }),
  Object.freeze({ capabilityId: "SUPRAGLOTTIC_AIRWAY", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "VASCULAR_ACCESS", status: "AVAILABLE", sourceModuleId: "CORE_RUNTIME" }),
]);

export const ALS_CARDIAC_ARREST_RHYTHM_AUDIT: readonly AlsCapabilityAuditFinding[] = Object.freeze([
  Object.freeze({ capabilityId: "CARDIAC_ARREST", classification: "EXISTING_CANONICAL", reason: "Owned by CARDIAC_ARREST_V1 PatientProcess." }),
  Object.freeze({ capabilityId: "CPR", classification: "EXISTING_CANONICAL", reason: "Canonical CPR effects produce configured partial-perfusion contributors." }),
  Object.freeze({ capabilityId: "DEFIBRILLATION", classification: "EXISTING_CANONICAL", reason: "Canonical factual attempt is separate from configured rhythm transition." }),
  Object.freeze({ capabilityId: "RHYTHM_STATE", classification: "EXISTING_CANONICAL", reason: "CARDIAC_ARREST_V1 owns the canonical rhythm state." }),
  Object.freeze({ capabilityId: "ROSC", classification: "EXISTING_CANONICAL", reason: "Configured transition creates explicit deterministic ROSC state and evidence." }),
]);
