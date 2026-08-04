import type { AnalyticsDiagnostic, MetricDefinition, MetricResult } from "@/models/analytics/Analytics";

export function validateMetricResult(result: MetricResult, definition?: MetricDefinition): readonly AnalyticsDiagnostic[] {
  const diagnostics: AnalyticsDiagnostic[] = [];
  if (!definition || result.providerId !== definition.providerId || result.metricVersion !== definition?.version || result.category !== definition?.category || result.scope !== definition?.scope) diagnostics.push(Object.freeze({ severity: "ERROR", code: "MALFORMED_RESULT", providerId: result.providerId, metricId: result.metricId, message: "Metric result does not match its registered definition" }));
  if (result.status === "VALUE" && typeof result.value === "number" && !Number.isFinite(result.value)) diagnostics.push(Object.freeze({ severity: "ERROR", code: "NON_FINITE_VALUE", providerId: result.providerId, metricId: result.metricId, message: "Numeric metric value must be finite" }));
  if (result.status === "VALUE" && result.evidence.length === 0) diagnostics.push(Object.freeze({ severity: "WARNING", code: "MISSING_EVIDENCE", providerId: result.providerId, metricId: result.metricId, message: "Production metric value has no evidence" }));
  return Object.freeze(diagnostics);
}

