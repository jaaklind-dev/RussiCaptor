import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const traumaCoreRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze([]),
  clinicalEffects: Object.freeze([]),
  interventions: Object.freeze([]),
  medications: Object.freeze([]),
  assessmentRules: Object.freeze([]),
  analyticsProviders: Object.freeze([]),
  metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze(["TRAUMATIC_INJURY_DESCRIPTOR_V1"]),
});
