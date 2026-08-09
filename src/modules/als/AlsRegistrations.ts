import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

/**
 * ALS_V1 is a composition boundary. Shared registrations remain owned by its
 * exact Airway and Medication Core dependencies. No canonical ALS-specific
 * runtime capability exists yet, so this module intentionally owns none.
 */
export const alsRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze([]),
  clinicalEffects: Object.freeze([]),
  interventions: Object.freeze([]),
  medications: Object.freeze([]),
  assessmentRules: Object.freeze([]),
  analyticsProviders: Object.freeze([]),
  metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze([]),
});
