import { TRAUMA_CORE_MODULE_ID } from "./TraumaCoreManifest";

export type TraumaCapabilityStatus = Readonly<{
  capabilityId: string;
  status: "FOUNDATION" | "PARTIAL" | "NOT_IMPLEMENTED";
  sourceModuleId?: string;
  reason: string;
}>;

export const TRAUMA_CORE_CAPABILITY_STATUS: readonly TraumaCapabilityStatus[] = Object.freeze([
  Object.freeze({ capabilityId: "TRAUMA_CONTEXT", status: "FOUNDATION", sourceModuleId: TRAUMA_CORE_MODULE_ID, reason: "Immutable mechanism and anatomic injury context." }),
  Object.freeze({ capabilityId: "TRAUMATIC_INJURY", status: "FOUNDATION", sourceModuleId: TRAUMA_CORE_MODULE_ID, reason: "Descriptive identity only; not a PatientProcess." }),
  Object.freeze({ capabilityId: "HEMORRHAGE_COMPATIBLE", status: "PARTIAL", reason: "Existing physiology is reusable after lifecycle bootstrap/source generalization." }),
  Object.freeze({ capabilityId: "RESPIRATORY_INJURY_COMPATIBLE", status: "PARTIAL", reason: "Existing contributor architecture is reusable; pleural impairment is not implemented." }),
  Object.freeze({ capabilityId: "PELVIC_HEMORRHAGE", status: "NOT_IMPLEMENTED", reason: "Reserved for WP-43." }),
  Object.freeze({ capabilityId: "HEMOPNEUMOTHORAX", status: "NOT_IMPLEMENTED", reason: "Reserved for WP-44." }),
]);

export const TRAUMA_INTERVENTION_BOUNDARIES = Object.freeze({
  PELVIC_BINDER: Object.freeze({ owner: "CORE_RUNTIME", status: "PARTIAL", reason: "Canonical intervention and PELVIC_STABILIZATION effect already exist; WP-43 must supply injury configuration and factual response without duplicate registration." }),
  CHEST_DRAIN: Object.freeze({ owner: "WP-44_PLEURAL_INJURY", status: "NOT_IMPLEMENTED", reason: "Its identity and pleural effect are injury-specific." }),
  PLEURAL_DECOMPRESSION: Object.freeze({ owner: "WP-44_PLEURAL_INJURY", status: "NOT_IMPLEMENTED", reason: "Introduce only if the accepted pleural model requires it." }),
});
