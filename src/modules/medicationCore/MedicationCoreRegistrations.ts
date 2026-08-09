import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const MEDICATION_CORE_PROCESS_ID = "MEDICATION" as const;

export const MEDICATION_CORE_ASSESSMENT_RULE_IDS = Object.freeze([
  "MED-ADMIN",
  "MED-CANCEL",
  "MED-DUP",
  "MED-REJECT",
] as const);

/**
 * Medication definitions and their Clinical Effects are exercise configuration,
 * not framework-owned content. The core module deliberately declares none.
 */
export const medicationCoreRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze([MEDICATION_CORE_PROCESS_ID]),
  clinicalEffects: Object.freeze([]),
  interventions: Object.freeze([]),
  medications: Object.freeze([]),
  assessmentRules: MEDICATION_CORE_ASSESSMENT_RULE_IDS,
  analyticsProviders: Object.freeze([]),
  metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze([]),
});
