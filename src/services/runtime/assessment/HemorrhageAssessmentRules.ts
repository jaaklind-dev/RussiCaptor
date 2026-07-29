import type { AssessmentRule } from "@/models/ClinicalAssessment";
export const hemorrhageAssessmentRules: AssessmentRule[] = [
  { ruleId: "HEM-CONTROLLED", name: "Hemorrhage controlled", category: "RESOURCES", severity: "INFO", condition: { type: "EVENT_PRESENT", eventType: "HemorrhageStopped" }, expectedBehaviour: "Control active hemorrhage." },
  { ruleId: "HEM-DELAY", name: "Hemorrhage control not delayed", category: "RESOURCES", severity: "WARNING", condition: { type: "EVENT_PRESENT", eventType: "HemorrhageReduced", deadlineSec: 300 }, expectedBehaviour: "Reduce hemorrhage within the configured exercise target." },
  { ruleId: "HEM-INFUSION", name: "Infusion started", category: "RESOURCES", severity: "INFO", condition: { type: "EVENT_PRESENT", eventType: "InfusionStarted" }, expectedBehaviour: "Start configured circulatory support when indicated." },
];
