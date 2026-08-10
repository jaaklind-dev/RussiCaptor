import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const cardiacArrestRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze(["CARDIAC_ARREST"]),
  clinicalEffects: Object.freeze(["CPR_STARTED", "CPR_STOPPED", "DEFIBRILLATION_ATTEMPT"]),
  interventions: Object.freeze(["DEFIBRILLATION", "START_CPR", "STOP_CPR"]),
  medications: Object.freeze([]),
  assessmentRules: Object.freeze([]),
  analyticsProviders: Object.freeze([]),
  metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze(["CARDIAC_ARREST_CONFIGURATION_V1"]),
});
