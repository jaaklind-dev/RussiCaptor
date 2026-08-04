import type { AnalyticsCategorySummary, AnalyticsConfiguration, AnalyticsDiagnostic, AnalyticsEvaluationContext, AnalyticsReport, MetricDefinition, MetricResult } from "@/models/analytics/Analytics";
import type { DebriefReport } from "@/services/debrief/DebriefModel";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { AnalyticsProviderRegistry } from "./AnalyticsProviderRegistry";
import { normalizeMetricResult } from "./AnalyticsPrecision";
import { validateMetricResult } from "./AnalyticsResultValidator";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const frozen = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value as Record<string, unknown>).forEach(frozen); Object.freeze(value); } return value; };
const resultKey = (result: MetricResult) => [result.category, result.providerId, result.metricId, result.scope, result.subjectId ?? "", result.status];
const sortResults = (a: MetricResult, b: MetricResult) => { const left = resultKey(a); const right = resultKey(b); for (let index = 0; index < left.length; index += 1) { const order = compare(left[index], right[index]); if (order) return order; } return 0; };
const errorResult = (definition: MetricDefinition, message: string): MetricResult => frozen({ metricId: definition.metricId, metricVersion: definition.version, providerId: definition.providerId, scope: definition.scope, category: definition.category, status: "ERROR", reasonCode: "PROVIDER_FAILURE", message, unit: definition.unit, evidence: [] });

function summarize(metrics: readonly MetricResult[]): readonly AnalyticsCategorySummary[] {
  const categories = [...new Set(metrics.map(metric => metric.category))].sort(compare);
  return Object.freeze(categories.map(category => { const values = metrics.filter(metric => metric.category === category); return Object.freeze({ category, metricCount: values.length, valueCount: values.filter(item => item.status === "VALUE").length, unavailableCount: values.filter(item => item.status === "UNAVAILABLE").length, notApplicableCount: values.filter(item => item.status === "NOT_APPLICABLE").length, errorCount: values.filter(item => item.status === "ERROR").length }); }));
}

export function generateAnalytics(debrief: DebriefReport, registry: AnalyticsProviderRegistry, configuration: AnalyticsConfiguration): AnalyticsReport {
  if (!debrief?.exerciseId || !debrief.generatedFromReplayHash) throw new Error("INVALID_DEBRIEF");
  const sourceDebriefHash = sha256Text(stableJson(debrief));
  const diagnostics: AnalyticsDiagnostic[] = []; const metrics: MetricResult[] = [];
  const enabledProviders = new Set(configuration.enabledProviderIds ?? registry.providers.map(provider => provider.providerId)); const enabledMetrics = new Set(configuration.enabledMetricIds ?? registry.definitions.map(definition => definition.metricId));
  for (const id of [...enabledProviders].sort(compare)) if (!registry.providers.some(provider => provider.providerId === id)) diagnostics.push(frozen({ severity: "WARNING", code: "UNKNOWN_PROVIDER", providerId: id, message: `Unknown provider ${id}` }));
  for (const id of [...enabledMetrics].sort(compare)) if (!registry.definitions.some(definition => definition.metricId === id)) diagnostics.push(frozen({ severity: "WARNING", code: "UNKNOWN_METRIC", metricId: id, message: `Unknown metric ${id}` }));
  if (debrief.clockMigrationStatus !== "CANONICAL") diagnostics.push(frozen({ severity: "WARNING", code: "LEGACY_EXERCISE_CLOCK", message: "Duration-dependent analytics may be unavailable" }));
  const context: AnalyticsEvaluationContext = frozen({ debrief, exerciseId: debrief.exerciseId, sourceDebriefHash, configuration: frozen(structuredClone(configuration)) });
  for (const provider of registry.providers.filter(item => enabledProviders.has(item.providerId))) {
    const definitions = registry.definitions.filter(definition => definition.providerId === provider.providerId && enabledMetrics.has(definition.metricId));
    try {
      const output = provider.evaluate(context).filter(result => enabledMetrics.has(result.metricId));
      for (const result of output) { const definition = definitions.find(item => item.metricId === result.metricId); const resultDiagnostics = validateMetricResult(result, definition); diagnostics.push(...resultDiagnostics); const canonicalEvidence = Object.freeze([...result.evidence].sort((a, b) => compare(stableJson(a), stableJson(b))).map(item => frozen(structuredClone(item)))); const canonicalResult = { ...structuredClone(result), evidence: canonicalEvidence } as MetricResult; metrics.push(resultDiagnostics.some(item => item.severity === "ERROR") ? errorResult(definition ?? { metricId: result.metricId, version: result.metricVersion, providerId: result.providerId, scope: result.scope, category: result.category, unit: result.unit, name: result.metricId, description: "Invalid provider result" }, "Provider returned a malformed result") : frozen(normalizeMetricResult(canonicalResult, configuration.precisionPolicy))); }
      for (const definition of definitions.filter(item => !output.some(result => result.metricId === item.metricId))) { diagnostics.push(frozen({ severity: "ERROR", code: "MISSING_RESULT", providerId: provider.providerId, metricId: definition.metricId, message: "Provider omitted an enabled metric" })); metrics.push(errorResult(definition, "Provider omitted result")); }
    } catch { diagnostics.push(frozen({ severity: "ERROR", code: "PROVIDER_EXCEPTION", providerId: provider.providerId, message: "Provider evaluation failed" })); metrics.push(...definitions.map(definition => errorResult(definition, "Provider evaluation failed"))); }
  }
  metrics.sort(sortResults); diagnostics.sort((a, b) => compare(a.code, b.code) || compare(a.providerId ?? "", b.providerId ?? "") || compare(a.metricId ?? "", b.metricId ?? ""));
  const canonical = { analyticsVersion: 1 as const, exerciseId: debrief.exerciseId, sourceDebriefHash, generatedAtSimulationTimeSec: debrief.generatedAtSimulationTime, providerRegistryVersion: registry.version, metrics: frozen(metrics), categories: summarize(metrics), diagnostics: frozen(diagnostics) };
  const hashInput = { ...canonical, configuration: frozen(structuredClone(configuration)) };
  return frozen({ ...canonical, analyticsHash: sha256Text(stableJson(hashInput)) });
}
