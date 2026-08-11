import type { ProtocolAssessmentReport, ProtocolAssessmentResult, ProtocolAssessmentStatus } from "@/models/assessment/ProtocolAssessment";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { stableJson } from "@/utils/stableJson";
import { generateAnalytics } from "../AnalyticsEngine";
import { AnalyticsProviderRegistry } from "../AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "../AnalyticsPrecision";
import { ExerciseSummaryMetricProvider } from "../providers/ExerciseSummaryMetricProvider";
import { aggregateAssessmentMetrics, ProtocolAssessmentMetricsProvider } from "../providers/ProtocolAssessmentMetricsProvider";

const result = (assessmentId: string, status: ProtocolAssessmentStatus, patientId?: string): ProtocolAssessmentResult => Object.freeze({ assessmentId, expectationId: `EXP-${assessmentId}`, protocolId: "ALS", protocolVersion: "1.0.0", ...(patientId ? { patientId, subjectId: patientId } : {}), status, evidence: Object.freeze([]), diagnostics: Object.freeze([]) });
const assessment = (results: readonly ProtocolAssessmentResult[]): ProtocolAssessmentReport => Object.freeze({ assessmentVersion: 1, exerciseId: "EX-A", protocolId: "ALS", protocolVersion: "1.0.0", protocolHash: "protocol-hash", sourceDebriefHash: "debrief-hash", results: Object.freeze([...results]), diagnostics: Object.freeze([]), assessmentHash: "assessment-hash" });
const debrief = reconstructDebrief({ exercise: { exerciseId: "EX-A", lifecycleState: "COMPLETED", simulationTimeSec: 100, speed: 1, version: 2, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 }, patients: [], timeline: [] });
const configuration = Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION });
const metric = (metrics: ReturnType<typeof aggregateAssessmentMetrics>, id: string) => metrics.find(item => item.metricId === id);

describe("WP-39 Assessment Metrics Foundation", () => {
  const source = assessment([result("01", "MET", "P001"), result("02", "MET", "P001"), result("03", "NOT_MET", "P002"), result("04", "UNAVAILABLE", "P002"), result("05", "NOT_APPLICABLE")]);

  it("derives the exact neutral exercise aggregates and denominator semantics", () => {
    const metrics = aggregateAssessmentMetrics(source, source.results, "EXERCISE");
    expect(metric(metrics, "assessment.expectations.total")).toMatchObject({ value: 5 });
    expect(metric(metrics, "assessment.expectations.applicable")).toMatchObject({ value: 4 });
    expect(metric(metrics, "assessment.expectations.assessable")).toMatchObject({ value: 3 });
    expect(metric(metrics, "assessment.expectations.met")).toMatchObject({ value: 2 });
    expect(metric(metrics, "assessment.expectations.not_met")).toMatchObject({ value: 1 });
    expect(metric(metrics, "assessment.expectations.unavailable")).toMatchObject({ value: 1 });
    expect(metric(metrics, "assessment.expectations.not_applicable")).toMatchObject({ value: 1 });
    expect(metric(metrics, "assessment.completion_ratio")).toMatchObject({ value: 0.75 });
    const satisfaction = metric(metrics, "assessment.satisfaction_ratio");
    expect(satisfaction?.status).toBe("VALUE");
    if (satisfaction?.status === "VALUE") expect(satisfaction.value).toBeCloseTo(2 / 3);
  });

  it("emits patient aggregates in natural deterministic Patient ID order", () => {
    const shuffled = assessment([result("10", "MET", "P010"), result("02", "NOT_MET", "P002"), result("01", "MET", "P001")]);
    const output = ProtocolAssessmentMetricsProvider.evaluate({ debrief, exerciseId: "EX-A", sourceDebriefHash: "x", configuration, protocolAssessment: shuffled });
    expect([...new Set(output.flatMap(item => item.subjectId ? [item.subjectId] : []))]).toEqual(["P001", "P002", "P010"]);
    expect(output.filter(item => item.scope === "PATIENT")).toHaveLength(27);
  });

  it("marks ratios not applicable when their denominator is zero", () => {
    const onlyExcluded = assessment([result("01", "NOT_APPLICABLE")]);
    const metrics = aggregateAssessmentMetrics(onlyExcluded, onlyExcluded.results, "EXERCISE");
    expect(metric(metrics, "assessment.completion_ratio")).toMatchObject({ status: "NOT_APPLICABLE", reasonCode: "ZERO_DENOMINATOR" });
    expect(metric(metrics, "assessment.satisfaction_ratio")).toMatchObject({ status: "NOT_APPLICABLE", reasonCode: "ZERO_DENOMINATOR" });
  });

  it("omits patient metrics without treating an exercise-only assessment as a provider error", () => {
    const exerciseOnly = assessment([result("01", "MET"), result("02", "NOT_APPLICABLE")]);
    const output = generateAnalytics(debrief, new AnalyticsProviderRegistry([ProtocolAssessmentMetricsProvider]), configuration, exerciseOnly);
    expect(output.metrics).toHaveLength(9);
    expect(output.metrics.every(item => item.scope === "EXERCISE")).toBe(true);
    expect(output.diagnostics).toEqual([]);
  });

  it("is deterministic across shuffled input and recursively immutable after canonicalization", () => {
    const firstReport = generateAnalytics(debrief, new AnalyticsProviderRegistry([ProtocolAssessmentMetricsProvider]), configuration, source);
    const reordered = assessment([...source.results].reverse());
    const secondReport = generateAnalytics(debrief, new AnalyticsProviderRegistry([ProtocolAssessmentMetricsProvider]), configuration, reordered);
    expect(secondReport).toEqual(firstReport);
    expect(secondReport.analyticsHash).toBe(firstReport.analyticsHash);
    expect(Object.isFrozen(secondReport.metrics[0].evidence)).toBe(true);
    expect(Object.isFrozen(secondReport.metrics[0].assessmentProvenance)).toBe(true);
  });

  it("preserves the historical analytics result exactly when no assessment exists", () => {
    const registry = new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider]);
    const historical = generateAnalytics(debrief, registry, configuration);
    const optionalUndefined = generateAnalytics(debrief, registry, configuration, undefined);
    expect(stableJson(optionalUndefined)).toBe(stableJson(historical));
    expect(optionalUndefined.analyticsHash).toBe(historical.analyticsHash);
    expect(ProtocolAssessmentMetricsProvider.evaluate({ debrief, exerciseId: "EX-A", sourceDebriefHash: "x", configuration })).toEqual([]);
  });

  it("isolates invalid assessment input without breaking another provider", () => {
    const invalid = { ...source, exerciseId: "OTHER" } as ProtocolAssessmentReport;
    const output = generateAnalytics(debrief, new AnalyticsProviderRegistry([ProtocolAssessmentMetricsProvider, ExerciseSummaryMetricProvider]), configuration, invalid);
    expect(output.metrics.filter(item => item.providerId === "assessment.protocol").every(item => item.status === "ERROR")).toBe(true);
    expect(output.metrics.find(item => item.metricId === "exercise.timeline.event_count")).toMatchObject({ status: "VALUE" });
  });

  it("handles 100 patients and 500 results without scanning Debrief timeline data", () => {
    const results = Array.from({ length: 500 }, (_, index) => result(String(index).padStart(3, "0"), index % 5 === 0 ? "NOT_MET" : "MET", `P${String(index % 100 + 1).padStart(3, "0")}`));
    const large = assessment(results); const started = Date.now();
    const output = ProtocolAssessmentMetricsProvider.evaluate({ debrief, exerciseId: "EX-A", sourceDebriefHash: "x", configuration, protocolAssessment: large });
    expect(output).toHaveLength(909); expect(Date.now() - started).toBeLessThan(1_000);
  });
});
