import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const pleuralInjuryRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze(["PLEURAL_INJURY"]),
  clinicalEffects: Object.freeze(["PLEURAL_DRAINAGE"]),
  interventions: Object.freeze(["CHEST_DRAIN_INSERTION"]),
  medications: Object.freeze([]), assessmentRules: Object.freeze([]), analyticsProviders: Object.freeze([]), metricProviders: Object.freeze([]),
  capabilities: Object.freeze([]), objectives: Object.freeze([]), validationRules: Object.freeze(["MASSIVE_HEMOPNEUMOTHORAX_CONFIGURATION_V1"]),
});
