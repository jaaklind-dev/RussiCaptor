import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";
export const massiveTransfusionRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze(["MASSIVE_TRANSFUSION"]), clinicalEffects: Object.freeze([]),
  interventions: Object.freeze(["MTP_ACTIVATION", "RBC_ADMINISTRATION", "PLASMA_ADMINISTRATION", "PLATELET_ADMINISTRATION"]), medications: Object.freeze([]),
  assessmentRules: Object.freeze([]), analyticsProviders: Object.freeze([]), metricProviders: Object.freeze([]), capabilities: Object.freeze([]),
  objectives: Object.freeze([]), validationRules: Object.freeze(["MASSIVE_TRANSFUSION_CONFIGURATION_V1"]), });
