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
import type { AnalyticsReport } from "@/models/analytics/Analytics";
import { getExercisePackage } from "./exercise/ExercisePackageService";
import { withExercisePackageMetadata } from "./analytics/AnalyticsPackageMetadata";
import { getProtocolAssessmentReport } from "./ProtocolAssessmentService";
import { ProtocolAssessmentMetricsProvider, PROTOCOL_ASSESSMENT_METRICS_PROVIDER_ID } from "./analytics/providers/ProtocolAssessmentMetricsProvider";

const coreProviders = [ExerciseMetricsProvider, PatientFlowMetricsProvider, OwnershipMetricsProvider, InterventionMetricsProvider, TimelineMetricsProvider, ResourceMetricsProvider] as const;
const registry = new AnalyticsProviderRegistry(coreProviders);
const assessmentRegistry = new AnalyticsProviderRegistry([...coreProviders, ProtocolAssessmentMetricsProvider]);
let version = ""; let report: AnalyticsReport | undefined;
function configuration(activeRegistry: AnalyticsProviderRegistry, withAssessment: boolean) {
  const definition = getExercisePackage(getCurrentExercise().id).definition;
  const allProviders = activeRegistry.providers.map(provider => provider.providerId);
  const allMetrics = activeRegistry.definitions.map(metric => metric.metricId);
  const enabledProviders = definition.enabledAnalyticsProviders.filter(id => allProviders.includes(id));
  const enabledMetrics = activeRegistry.definitions.filter(metric => definition.enabledMetricProviders.includes(metric.providerId)).map(metric => metric.metricId);
  if (withAssessment) { enabledProviders.push(PROTOCOL_ASSESSMENT_METRICS_PROVIDER_ID); enabledMetrics.push(...activeRegistry.definitions.filter(metric => metric.providerId === PROTOCOL_ASSESSMENT_METRICS_PROVIDER_ID).map(metric => metric.metricId)); }
  return Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION,
    ...(enabledProviders.length === allProviders.length ? {} : { enabledProviderIds: Object.freeze(enabledProviders) }),
    ...(enabledMetrics.length === allMetrics.length ? {} : { enabledMetricIds: Object.freeze(enabledMetrics) }),
  });
}
export function getAnalyticsReport() { const assessment = getProtocolAssessmentReport(); const next = `${getDebriefVersion()}:${assessment?.assessmentHash ?? "NO_ASSESSMENT"}`; if (!report || version !== next) { const activeRegistry = assessment ? assessmentRegistry : registry; const generated = generateAnalytics(getDebriefReport(), activeRegistry, configuration(activeRegistry, Boolean(assessment)), assessment); report = withExercisePackageMetadata(generated, getExercisePackage(generated.exerciseId)); version = next; } return report; }
export function getAnalyticsVersion(): string { return getDebriefVersion(); }
export function subscribeToAnalytics(listener: () => void): () => void { return subscribeToDebrief(listener); }
export function getAnalyticsMetricDefinitions() { return getProtocolAssessmentReport() ? assessmentRegistry.definitions : registry.definitions; }
