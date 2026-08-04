import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { generateAnalytics } from "../AnalyticsEngine";
import { AnalyticsProviderRegistry } from "../AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "../AnalyticsPrecision";
import { ExerciseSummaryMetricProvider } from "../providers/ExerciseSummaryMetricProvider";

test("analytics canonical hash is stable across supported Node versions", () => {
  const debrief = reconstructDebrief({ exercise: { exerciseId: "HASH", lifecycleState: "COMPLETED", simulationTimeSec: 123.45, speed: 1, version: 2, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 }, patients: [], timeline: [] });
  const run = () => generateAnalytics(debrief, new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider]), { precisionPolicy: DEFAULT_ANALYTICS_PRECISION });
  const first = run(); const second = run(); expect(second).toEqual(first); expect(second.analyticsHash).toBe(first.analyticsHash);
});

