import type { AirwayState } from "@/models/AirwayState";
import type { GoldenActualEvent } from "@/models/GoldenTest";
import type { InterventionInstance } from "@/models/InterventionInstance";
import type { ResourceRuntimeEvent, RuntimeResource } from "@/models/ResourceRuntime";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { ClinicalIntegrationEvent } from "@/models/ClinicalIntegration";

export type AssessmentCategory = "AIRWAY" | "OXYGENATION" | "VENTILATION" | "MONITORING" | "RESOURCES" | "VITALS";
export type AssessmentSeverity = "INFO" | "WARNING" | "FAIL";
export type AssessmentResultStatus = "PASS" | "WARNING" | "FAIL" | "INFO" | "NOT_APPLICABLE";

export type AssessmentCondition =
  | { type: "EVENT_PRESENT"; eventType: string; minCount?: number; deadlineSec?: number }
  | { type: "EVENT_ABSENT"; eventType: string }
  | { type: "EVENT_ORDER"; beforeEventType: string; afterEventType: string }
  | { type: "EVENT_COUNT_MAX"; eventType: string; maxCount: number }
  | { type: "INTERVENTION_REJECTED"; reasonCode?: string; expected: boolean }
  | { type: "RESOURCE_CONFLICT"; expected: boolean }
  | { type: "VITAL_TREND"; expected: "IMPROVING" | "DETERIORATING" | "STABLE" | "UNSTABLE" }
  | { type: "MONITOR_QUALITY"; equals: "VALID" | "UNRELIABLE" | "LOST" | "OFFLINE" }
  | { type: "AIRWAY_STATE"; field: "activeAirway" | "currentVentilation" | "confirmed"; equals: string | boolean };

export type AssessmentRule = {
  ruleId: string;
  name: string;
  category: AssessmentCategory;
  severity: AssessmentSeverity;
  condition: AssessmentCondition;
  expectedBehaviour: string;
  applicability?: AssessmentCondition;
};

export type AssessmentResult = {
  ruleId: string;
  name: string;
  category: AssessmentCategory;
  severity: AssessmentSeverity;
  status: AssessmentResultStatus;
  expectedBehaviour: string;
  evaluatedAt: number;
  evidence: string[];
};

export type AssessmentEvent = {
  eventType: "AssessmentPassed" | "AssessmentWarning" | "AssessmentFailed";
  timestamp: number;
  ruleId: string;
  category: AssessmentCategory;
  status: AssessmentResultStatus;
  evidence: string[];
};

export type AssessmentSourceSnapshot = {
  timestamp: number;
  runtimeState: RuntimeState;
  eventLog: GoldenActualEvent[];
  interventionLog: ResourceRuntimeEvent[];
  interventionInstances: InterventionInstance[];
  resourcePool: RuntimeResource[];
  airwayState: AirwayState;
  clinicalEffects: ClinicalIntegrationEvent[];
  timeline: GoldenActualEvent[];
};

export type DebriefReport = {
  generatedAt: number;
  simulationSummary: {
    encounterId: string;
    globalStatus: string;
    durationSec: number;
  };
  completedInterventions: InterventionInstance[];
  timeline: GoldenActualEvent[];
  assessmentFindings: AssessmentResult[];
  warnings: AssessmentResult[];
  failedRules: AssessmentResult[];
  strengths: string[];
  improvementOpportunities: string[];
};

export type AssessmentSnapshot = {
  results: AssessmentResult[];
  events: AssessmentEvent[];
  debrief: DebriefReport;
};
