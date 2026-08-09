import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";

export const AIRWAY_INTERVENTION_IDS = Object.freeze([
  "BAG_VALVE_MASK_VENTILATION",
  "ENDOTRACHEAL_INTUBATION",
  "MECHANICAL_VENTILATION",
  "NASOPHARYNGEAL_AIRWAY",
  "OROPHARYNGEAL_AIRWAY",
  "OXYGEN_THERAPY",
  "SUPRAGLOTTIC_IGEL",
  "SUPRAGLOTTIC_LMA",
] as const);

export const AIRWAY_CLINICAL_EFFECT_IDS = Object.freeze([
  "AIRWAY_PROTECTED",
  "EFFECTIVE_VENTILATION",
  "INSPIRED_OXYGEN_INCREASED",
  "UPPER_AIRWAY_PATENCY",
] as const);

export const airwayRegistrations: ClinicalModuleRegistrations = Object.freeze({
  patientProcesses: Object.freeze([]),
  clinicalEffects: AIRWAY_CLINICAL_EFFECT_IDS,
  interventions: AIRWAY_INTERVENTION_IDS,
  medications: Object.freeze([]),
  assessmentRules: Object.freeze([]),
  analyticsProviders: Object.freeze(["core.interventions"]),
  metricProviders: Object.freeze(["core.interventions"]),
  capabilities: Object.freeze([]),
  objectives: Object.freeze([]),
  validationRules: Object.freeze([]),
});
