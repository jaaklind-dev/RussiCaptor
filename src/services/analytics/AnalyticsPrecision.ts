import type { AnalyticsPrecisionPolicy, MetricResult } from "@/models/analytics/Analytics";

export const DEFAULT_ANALYTICS_PRECISION: AnalyticsPrecisionPolicy = Object.freeze({ secondsDecimals: 0, percentDecimals: 2, ratioDecimals: 4, genericDecimals: 4 });
export function normalizeMetricResult(result: MetricResult, policy: AnalyticsPrecisionPolicy): MetricResult {
  if (result.status !== "VALUE" || typeof result.value !== "number") return result;
  const decimals = result.unit === "SECONDS" ? policy.secondsDecimals : result.unit === "PERCENT" ? policy.percentDecimals : result.unit === "RATIO" ? policy.ratioDecimals : policy.genericDecimals;
  const factor = 10 ** decimals; return Object.freeze({ ...result, value: Math.round((result.value + Number.EPSILON) * factor) / factor });
}

