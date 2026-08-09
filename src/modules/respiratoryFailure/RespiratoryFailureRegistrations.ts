import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const RESPIRATORY_FAILURE_PROCESS_ID = "RESPIRATORY_FAILURE" as const;

/**
 * Airway-owned support effects and intervention/provider bindings arrive through
 * the exact AIRWAY_V1 dependency. Only the additional existing removal effect
 * is declared here, avoiding duplicate registration ownership.
 */
export const RESPIRATORY_FAILURE_OWN_CLINICAL_EFFECT_IDS = Object.freeze([
  "INSPIRED_OXYGEN_REMOVED",
] as const);

export const RESPIRATORY_FAILURE_CONSUMED_CLINICAL_EFFECT_IDS = Object.freeze([
  "AIRWAY_PROTECTED",
  "EFFECTIVE_VENTILATION",
  "INSPIRED_OXYGEN_INCREASED",
  "INSPIRED_OXYGEN_REMOVED",
  "UPPER_AIRWAY_PATENCY",
] as const);

export const RESPIRATORY_FAILURE_PHENOTYPES = Object.freeze([
  "HYPERCAPNIC",
  "HYPOXAEMIC",
  "MIXED",
] as const);

export const respiratoryFailureRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze([RESPIRATORY_FAILURE_PROCESS_ID]),
  clinicalEffects: RESPIRATORY_FAILURE_OWN_CLINICAL_EFFECT_IDS,
  interventions: Object.freeze([]),
  medications: Object.freeze([]),
  assessmentRules: Object.freeze([]),
  analyticsProviders: Object.freeze([]),
  metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze([]),
});
