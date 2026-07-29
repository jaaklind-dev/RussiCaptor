import type { AssessmentRule } from "@/models/ClinicalAssessment";

export const vitalSignAssessmentRules: AssessmentRule[] = [
  { ruleId: "VITALS-IMPROVING", name: "Vitals improving", category: "VITALS", severity: "INFO", condition: { type: "VITAL_TREND", expected: "IMPROVING" }, expectedBehaviour: "Monitor whether vital signs improve after treatment." },
  { ruleId: "VITALS-DETERIORATING", name: "Vitals not deteriorating", category: "VITALS", severity: "WARNING", condition: { type: "VITAL_TREND", expected: "IMPROVING" }, expectedBehaviour: "Recognise a deteriorating vital-sign trend." },
  { ruleId: "VITALS-STABILITY", name: "Vitals stable", category: "VITALS", severity: "WARNING", condition: { type: "VITAL_TREND", expected: "STABLE" }, expectedBehaviour: "Recognise an unstable trend." },
  { ruleId: "MONITOR-ONLINE", name: "Monitor online", category: "MONITORING", severity: "WARNING", condition: { type: "MONITOR_QUALITY", equals: "VALID" }, expectedBehaviour: "Restore reliable monitoring." },
];
