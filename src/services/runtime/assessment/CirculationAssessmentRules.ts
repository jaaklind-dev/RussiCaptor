import type { AssessmentRule } from "@/models/ClinicalAssessment";

export const circulationAssessmentRules: AssessmentRule[] = [
  { ruleId: "CIRC-IV", name: "IV established", category: "RESOURCES", severity: "INFO",
    condition: { type: "EVENT_PRESENT", eventType: "VascularAccessEstablished" }, expectedBehaviour: "Establish vascular access when required." },
  { ruleId: "CIRC-TOURNIQUET", name: "Tourniquet applied", category: "RESOURCES", severity: "INFO",
    condition: { type: "EVENT_PRESENT", eventType: "TourniquetApplied" }, expectedBehaviour: "Apply hemorrhage control when indicated." },
  { ruleId: "CIRC-PELVIC", name: "Pelvic binder applied", category: "RESOURCES", severity: "INFO",
    condition: { type: "EVENT_PRESENT", eventType: "PelvicBinderApplied" }, expectedBehaviour: "Apply pelvic stabilization when indicated." },
  { ruleId: "CIRC-BLOOD", name: "Blood administration started", category: "RESOURCES", severity: "INFO",
    condition: { type: "EVENT_PRESENT", eventType: "InfusionStarted" }, expectedBehaviour: "Start the configured blood product intervention when indicated." },
  { ruleId: "CIRC-REJECTED", name: "No rejected circulation intervention", category: "RESOURCES", severity: "WARNING",
    condition: { type: "INTERVENTION_REJECTED", expected: false }, expectedBehaviour: "Use available circulation resources without conflicts." },
];
