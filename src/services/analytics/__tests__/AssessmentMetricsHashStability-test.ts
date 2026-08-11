import type { ProtocolAssessmentReport } from "@/models/assessment/ProtocolAssessment";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { generateAnalytics } from "../AnalyticsEngine";
import { AnalyticsProviderRegistry } from "../AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "../AnalyticsPrecision";
import { ProtocolAssessmentMetricsProvider } from "../providers/ProtocolAssessmentMetricsProvider";

test("assessment metrics analytics hash is stable across supported Node versions", () => {
  const debrief = reconstructDebrief({ exercise: { exerciseId: "ASSESSMENT-HASH", lifecycleState: "COMPLETED", simulationTimeSec: 60, speed: 1, version: 2, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 }, patients: [], timeline: [] });
  const assessment: ProtocolAssessmentReport = Object.freeze({ assessmentVersion: 1, exerciseId: "ASSESSMENT-HASH", protocolId: "ALS-ADULT", protocolVersion: "1.0.0", protocolHash: "protocol", sourceDebriefHash: "debrief", results: Object.freeze([Object.freeze({ assessmentId: "A-1", expectationId: "CPR", protocolId: "ALS-ADULT", protocolVersion: "1.0.0", patientId: "P001", subjectId: "P001", status: "MET", evidence: Object.freeze([]), diagnostics: Object.freeze([]) }), Object.freeze({ assessmentId: "A-2", expectationId: "SHOCK", protocolId: "ALS-ADULT", protocolVersion: "1.0.0", patientId: "P001", subjectId: "P001", status: "NOT_MET", evidence: Object.freeze([]), diagnostics: Object.freeze([]) })]), diagnostics: Object.freeze([]), assessmentHash: "assessment" });
  const run = () => generateAnalytics(debrief, new AnalyticsProviderRegistry([ProtocolAssessmentMetricsProvider]), { precisionPolicy: DEFAULT_ANALYTICS_PRECISION }, assessment);
  const first = run(); const second = run();
  expect(second).toEqual(first); expect(second.analyticsHash).toBe(first.analyticsHash);
});
