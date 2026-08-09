import { AIRWAY_MODULE_ID } from "@/modules/airway/AirwayManifest";
import { MEDICATION_CORE_MODULE_ID } from "@/modules/medicationCore/MedicationCoreManifest";

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

const noCanonicalRuntime = "No existing canonical runtime implementation.";

export const ALS_CAPABILITY_STATUS: readonly AlsCapabilityStatus[] = Object.freeze([
  Object.freeze({ capabilityId: "BAG_VALVE_MASK_VENTILATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "CARDIAC_ARREST", status: "UNAVAILABLE", reason: noCanonicalRuntime }),
  Object.freeze({ capabilityId: "CPR_PHYSIOLOGY", status: "UNAVAILABLE", reason: "CPR exists only as a workflow activity type; no canonical physiology implementation exists." }),
  Object.freeze({ capabilityId: "DEFIBRILLATION", status: "UNAVAILABLE", reason: "Defibrillation exists only as a workflow activity type; no canonical clinical implementation exists." }),
  Object.freeze({ capabilityId: "ENDOTRACHEAL_INTUBATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "MECHANICAL_VENTILATION", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "MEDICATION_ADMINISTRATION", status: "AVAILABLE", sourceModuleId: MEDICATION_CORE_MODULE_ID }),
  Object.freeze({ capabilityId: "OXYGEN_THERAPY", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "RHYTHM_STATE", status: "UNAVAILABLE", reason: noCanonicalRuntime }),
  Object.freeze({ capabilityId: "ROSC", status: "UNAVAILABLE", reason: noCanonicalRuntime }),
  Object.freeze({ capabilityId: "SUPRAGLOTTIC_AIRWAY", status: "AVAILABLE", sourceModuleId: AIRWAY_MODULE_ID }),
  Object.freeze({ capabilityId: "VASCULAR_ACCESS", status: "AVAILABLE", sourceModuleId: "CORE_RUNTIME" }),
]);

export const ALS_CARDIAC_ARREST_RHYTHM_AUDIT: readonly AlsCapabilityAuditFinding[] = Object.freeze([
  Object.freeze({ capabilityId: "CARDIAC_ARREST", classification: "NOT_IMPLEMENTED", reason: noCanonicalRuntime }),
  Object.freeze({ capabilityId: "CPR", classification: "PARTIAL", reason: "Workflow and Excel activity type only; no canonical PatientProcess, Clinical Effect, or physiology implementation." }),
  Object.freeze({ capabilityId: "DEFIBRILLATION", classification: "PARTIAL", reason: "Workflow and Excel activity type only; no canonical intervention effect or rhythm transition." }),
  Object.freeze({ capabilityId: "RHYTHM_STATE", classification: "NOT_IMPLEMENTED", reason: noCanonicalRuntime }),
  Object.freeze({ capabilityId: "ROSC", classification: "NOT_IMPLEMENTED", reason: noCanonicalRuntime }),
]);
