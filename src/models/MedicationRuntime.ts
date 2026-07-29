import type { ClinicalEffectType, ClinicalParameterValue } from "@/models/ClinicalIntegration";

export type MedicationRoute = "IV" | "IO" | "IM" | "PO";
export type MedicationCategory = "vasopressor" | "antiarrhythmic" | "analgesic" | "sedative" | "crystalloid" | "bloodProduct" | "reversalAgent" | "other";
export type MedicationDefinition = { medicationId: string; name: string; routes: MedicationRoute[]; category: MedicationCategory;
  supportedEffects: { effectType: ClinicalEffectType; parameters?: Record<string, ClinicalParameterValue> }[];
  durationSec: number; metadata: Record<string, unknown> };
export type MedicationAdministration = { administrationId: string; medicationId: string; patientId: string; route: MedicationRoute;
  dose: number; unit: string; timestamp: number; administrator: string; vascularAccessId?: string };
export type MedicationStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
export type MedicationInstance = MedicationAdministration & { medicationName: string; category: MedicationCategory;
  status: MedicationStatus; completedAt?: number; cancelledAt?: number };
export type MedicationRejectionReason = "DEFINITION_NOT_FOUND" | "INVALID_ROUTE" | "MISSING_VASCULAR_ACCESS" | "DUPLICATE_ADMINISTRATION" | "INVALID_ADMINISTRATION";
export type MedicationRuntimeEvent = { eventType: "MedicationOrdered" | "MedicationStarted" | "MedicationCompleted" | "MedicationCancelled" | "MedicationRejected";
  timestamp: number; administrationId: string; medicationId: string; patientId: string; reasonCode?: MedicationRejectionReason };
