import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { generateAnalytics } from "../AnalyticsEngine";
import { AnalyticsProviderRegistry } from "../AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "../AnalyticsPrecision";
import { ExerciseMetricsProvider } from "../providers/ExerciseMetricsProvider";
import { InterventionMetricsProvider } from "../providers/InterventionMetricsProvider";
import { OwnershipMetricsProvider } from "../providers/OwnershipMetricsProvider";
import { PatientFlowMetricsProvider } from "../providers/PatientFlowMetricsProvider";
import { ResourceMetricsProvider } from "../providers/ResourceMetricsProvider";
import { TimelineMetricsProvider } from "../providers/TimelineMetricsProvider";

test("analytics canonical hash is stable across supported Node versions", () => {
  const debrief = reconstructDebrief({ exercise: { exerciseId: "HASH", lifecycleState: "COMPLETED", simulationTimeSec: 123.45, speed: 1, version: 2, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 }, patients: [], timeline: [] });
  const run = () => generateAnalytics(debrief, new AnalyticsProviderRegistry([ExerciseMetricsProvider, PatientFlowMetricsProvider, OwnershipMetricsProvider, InterventionMetricsProvider, TimelineMetricsProvider, ResourceMetricsProvider]), { precisionPolicy: DEFAULT_ANALYTICS_PRECISION });
  const first = run(); const second = run(); expect(second).toEqual(first); expect(second.analyticsHash).toBe(first.analyticsHash);
});
