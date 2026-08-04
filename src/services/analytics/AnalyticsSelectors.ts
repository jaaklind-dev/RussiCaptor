import type { AnalyticsFilters, AnalyticsReport, MetricResult } from "@/models/analytics/Analytics";

export function filterAnalyticsMetrics(report: AnalyticsReport, filters: AnalyticsFilters): readonly MetricResult[] {
  const query = filters.search?.trim().toLowerCase();
  return Object.freeze(report.metrics.filter(metric =>
    (!filters.category || metric.category === filters.category) && (!filters.providerId || metric.providerId === filters.providerId) &&
    (!filters.scope || metric.scope === filters.scope) && (!filters.status || metric.status === filters.status) &&
    (!filters.patientId || metric.subjectId === filters.patientId || metric.evidence.some(item => item.patientId === filters.patientId)) &&
    (!query || `${metric.metricId} ${metric.providerId} ${metric.category} ${metric.status} ${"message" in metric ? metric.message : ""}`.toLowerCase().includes(query))
  ));
}

