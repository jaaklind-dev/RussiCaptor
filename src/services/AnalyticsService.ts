import { getDebriefReport, getDebriefVersion, subscribeToDebrief } from "./DebriefService";
import { generateAnalytics } from "./analytics/AnalyticsEngine";
import { AnalyticsProviderRegistry } from "./analytics/AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "./analytics/AnalyticsPrecision";
import { ExerciseMetricsProvider } from "./analytics/providers/ExerciseMetricsProvider";
import { PatientFlowMetricsProvider } from "./analytics/providers/PatientFlowMetricsProvider";
import { OwnershipMetricsProvider } from "./analytics/providers/OwnershipMetricsProvider";
import { InterventionMetricsProvider } from "./analytics/providers/InterventionMetricsProvider";
import { TimelineMetricsProvider } from "./analytics/providers/TimelineMetricsProvider";
import { ResourceMetricsProvider } from "./analytics/providers/ResourceMetricsProvider";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getExerciseDefinition } from "./exercise/ExerciseDefinitionService";
import type { AnalyticsReport } from "@/models/analytics/Analytics";
import { getExercisePackage } from "./exercise/ExercisePackageService";
import { withExercisePackageMetadata } from "./analytics/AnalyticsPackageMetadata";

const registry = new AnalyticsProviderRegistry([ExerciseMetricsProvider, PatientFlowMetricsProvider, OwnershipMetricsProvider, InterventionMetricsProvider, TimelineMetricsProvider, ResourceMetricsProvider]);
let version = ""; let report: AnalyticsReport | undefined;
function configuration() {
  const definition = getExerciseDefinition(getCurrentExercise().id);
  const allProviders = registry.providers.map(provider => provider.providerId);
  const allMetrics = registry.definitions.map(metric => metric.metricId);
  const enabledProviders = definition.enabledAnalyticsProviders.filter(id => allProviders.includes(id));
  const enabledMetrics = registry.definitions.filter(metric => definition.enabledMetricProviders.includes(metric.providerId)).map(metric => metric.metricId);
  return Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION,
    ...(enabledProviders.length === allProviders.length ? {} : { enabledProviderIds: Object.freeze(enabledProviders) }),
    ...(enabledMetrics.length === allMetrics.length ? {} : { enabledMetricIds: Object.freeze(enabledMetrics) }),
  });
}
export function getAnalyticsReport() { const next = getDebriefVersion(); if (!report || version !== next) { const generated = generateAnalytics(getDebriefReport(), registry, configuration()); report = withExercisePackageMetadata(generated, getExercisePackage(generated.exerciseId)); version = next; } return report; }
export function getAnalyticsVersion(): string { return getDebriefVersion(); }
export function subscribeToAnalytics(listener: () => void): () => void { return subscribeToDebrief(listener); }
export function getAnalyticsMetricDefinitions() { return registry.definitions; }
