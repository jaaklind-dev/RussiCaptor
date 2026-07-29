import type { AssessmentRule } from "@/models/ClinicalAssessment";
export const medicationAssessmentRules: AssessmentRule[] = [
  { ruleId: "MED-ADMIN", name: "Medication administered", category: "RESOURCES", severity: "INFO", condition: { type: "EVENT_PRESENT", eventType: "MedicationStarted" }, expectedBehaviour: "Administer configured medication when indicated." },
  { ruleId: "MED-REJECT", name: "No rejected medication", category: "RESOURCES", severity: "WARNING", condition: { type: "EVENT_ABSENT", eventType: "MedicationRejected" }, expectedBehaviour: "Use a supported route and required vascular access." },
  { ruleId: "MED-DUP", name: "No duplicate medication administration", category: "RESOURCES", severity: "WARNING", condition: { type: "EVENT_COUNT_MAX", eventType: "MedicationRejected", maxCount: 0 }, expectedBehaviour: "Avoid duplicate administration IDs." },
  { ruleId: "MED-CANCEL", name: "Medication cancellation recorded", category: "RESOURCES", severity: "INFO", condition: { type: "EVENT_PRESENT", eventType: "MedicationCancelled" }, expectedBehaviour: "Record medication cancellation when it occurs." },
];
