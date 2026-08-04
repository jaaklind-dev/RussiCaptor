import type { AnalyticsMetricProvider, MetricDefinition, MetricResult } from "@/models/analytics/Analytics";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { stableJson } from "@/utils/stableJson";
import { generateAnalytics } from "../AnalyticsEngine";
import { AnalyticsProviderRegistry, AnalyticsRegistryError } from "../AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "../AnalyticsPrecision";
import { filterAnalyticsMetrics } from "../AnalyticsSelectors";
import { ExerciseSummaryMetricProvider } from "../providers/ExerciseSummaryMetricProvider";

const snapshot = (canonical = true): CanonicalExerciseSnapshot => ({ exerciseId: "EX-A", lifecycleState: "COMPLETED", simulationTimeSec: 125, speed: 1, version: 2, ...(canonical ? { clockVersion: 2 as const, clockInitializedAtSimulationTimeSec: 0 } : {}) });
const debrief = (canonical = true, timelineLength = 2) => reconstructDebrief({ exercise: snapshot(canonical), patients: [], timeline: Array.from({ length: timelineLength }, (_, index) => Object.freeze({ id: `E-${index}`, exerciseId: "EX-A", simulationTimeSec: index, sequenceNumber: index + 1, category: "PATIENT" as const, type: "NOTE", severity: "INFO" as const, title: `Event ${index}` })) });
const configuration = Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION });

function provider(providerId: string, metricId: string, value = 1.23456): AnalyticsMetricProvider {
  const definition: MetricDefinition = Object.freeze({ metricId, version: "1", name: metricId, description: "Test metric", category: "SYSTEM", unit: "RATIO", scope: "EXERCISE", providerId });
  return Object.freeze({ providerId, version: "1", getDefinitions: () => [definition], evaluate: (): readonly MetricResult[] => [Object.freeze({ metricId, metricVersion: "1", providerId, category: "SYSTEM", scope: "EXERCISE", status: "VALUE", value, unit: "RATIO", evidence: [Object.freeze({ sourceType: "DEBRIEF_FIELD", fieldPath: "exerciseId" })] })] });
}

describe("WP-25 Analytics Framework", () => {
  it("generates immutable neutral metrics with evidence and normalized precision", () => {
    const report = generateAnalytics(debrief(), new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider, provider("test", "test.ratio")]), configuration);
    expect(report.metrics.map(item => item.metricId)).toEqual(["exercise.duration.seconds", "exercise.timeline.event_count", "test.ratio"]);
    expect(report.metrics.find(item => item.metricId === "test.ratio")).toMatchObject({ status: "VALUE", value: 1.2346 });
    expect(report.categories).toEqual([{ category: "EXERCISE_FLOW", metricCount: 2, valueCount: 2, unavailableCount: 0, notApplicableCount: 0, errorCount: 0 }, { category: "SYSTEM", metricCount: 1, valueCount: 1, unavailableCount: 0, notApplicableCount: 0, errorCount: 0 }]);
    expect(Object.isFrozen(report)).toBe(true); expect(report.metrics.every(item => item.evidence.length > 0)).toBe(true);
  });

  it("rejects duplicate provider and metric IDs and ignores registration order", () => {
    expect(() => new AnalyticsProviderRegistry([provider("same", "one"), provider("same", "two")])).toThrow(AnalyticsRegistryError);
    expect(() => new AnalyticsProviderRegistry([provider("a", "same"), provider("b", "same")])).toThrow(AnalyticsRegistryError);
    const first = generateAnalytics(debrief(), new AnalyticsProviderRegistry([provider("z", "z.metric"), provider("a", "a.metric")]), configuration);
    const second = generateAnalytics(debrief(), new AnalyticsProviderRegistry([provider("a", "a.metric"), provider("z", "z.metric")]), configuration);
    expect(second).toEqual(first); expect(second.analyticsHash).toBe(first.analyticsHash);
  });

  it("isolates provider failures and continues deterministic output", () => {
    const broken: AnalyticsMetricProvider = { providerId: "broken", version: "1", getDefinitions: () => provider("broken", "broken.metric").getDefinitions(), evaluate: () => { throw new Error("boom"); } };
    const report = generateAnalytics(debrief(), new AnalyticsProviderRegistry([broken, ExerciseSummaryMetricProvider]), configuration);
    expect(report.metrics.find(item => item.metricId === "broken.metric")).toMatchObject({ status: "ERROR", reasonCode: "PROVIDER_FAILURE" });
    expect(report.metrics.find(item => item.metricId === "exercise.timeline.event_count")?.status).toBe("VALUE");
    expect(report.diagnostics.some(item => item.code === "PROVIDER_EXCEPTION")).toBe(true);
  });

  it("reports unknown configuration and malformed or missing provider output", () => {
    const malformed: AnalyticsMetricProvider = { ...provider("bad", "bad.metric"), evaluate: () => [{ ...provider("bad", "bad.metric").evaluate({} as never)[0], metricVersion: "wrong", evidence: [] }] };
    const report = generateAnalytics(debrief(), new AnalyticsProviderRegistry([malformed]), { ...configuration, enabledProviderIds: ["bad", "unknown"], enabledMetricIds: ["bad.metric", "unknown.metric"] });
    expect(report.metrics[0].status).toBe("ERROR");
    expect(report.diagnostics.map(item => item.code)).toEqual(["MALFORMED_RESULT", "MISSING_EVIDENCE", "UNKNOWN_METRIC", "UNKNOWN_PROVIDER"]);
  });

  it("does not emit a misleading duration for a legacy clock", () => {
    const report = generateAnalytics(debrief(false), new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider]), configuration);
    expect(report.metrics.find(item => item.metricId === "exercise.duration.seconds")).toMatchObject({ status: "UNAVAILABLE", reasonCode: "LEGACY_EXERCISE_CLOCK" });
    expect(report.metrics.find(item => item.metricId === "exercise.timeline.event_count")).toMatchObject({ status: "VALUE", value: 2 });
    expect(report.diagnostics.some(item => item.code === "LEGACY_EXERCISE_CLOCK")).toBe(true);
  });

  it("supports immutable presentation-only filtering", () => {
    const report = generateAnalytics(debrief(), new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider]), configuration); const before = stableJson(report);
    expect(filterAnalyticsMetrics(report, { status: "VALUE", search: "timeline" }).map(item => item.metricId)).toEqual(["exercise.timeline.event_count"]);
    expect(stableJson(report)).toBe(before);
  });

  it("supports 50 providers and 500 results over a 10,000-event Debrief", () => {
    const providers = Array.from({ length: 50 }, (_, providerIndex): AnalyticsMetricProvider => {
      const definitions = Array.from({ length: 10 }, (_, metricIndex): MetricDefinition => Object.freeze({ metricId: `load.${providerIndex}.${metricIndex}`, version: "1", name: "Load", description: "Load", category: "SYSTEM", unit: "COUNT", scope: "EXERCISE", providerId: `load.${String(providerIndex).padStart(2, "0")}` }));
      return Object.freeze({ providerId: `load.${String(providerIndex).padStart(2, "0")}`, version: "1", getDefinitions: () => definitions, evaluate: () => definitions.map(definition => Object.freeze({ metricId: definition.metricId, metricVersion: "1", providerId: definition.providerId, category: definition.category, scope: definition.scope, status: "VALUE", value: 10_000, unit: "COUNT", evidence: [Object.freeze({ sourceType: "DEBRIEF_FIELD", fieldPath: "timelineLength" })] })) });
    });
    const started = Date.now(); const report = generateAnalytics(debrief(true, 10_000), new AnalyticsProviderRegistry(providers), configuration);
    expect(report.metrics).toHaveLength(500); expect(Date.now() - started).toBeLessThan(2_000);
  });
});

