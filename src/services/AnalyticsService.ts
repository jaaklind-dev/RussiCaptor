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

const registry = new AnalyticsProviderRegistry([ExerciseMetricsProvider, PatientFlowMetricsProvider, OwnershipMetricsProvider, InterventionMetricsProvider, TimelineMetricsProvider, ResourceMetricsProvider]);
let version = ""; let report: ReturnType<typeof generateAnalytics> | undefined;
export function getAnalyticsReport() { const next = getDebriefVersion(); if (!report || version !== next) { report = generateAnalytics(getDebriefReport(), registry, Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION })); version = next; } return report; }
export function getAnalyticsVersion(): string { return getDebriefVersion(); }
export function subscribeToAnalytics(listener: () => void): () => void { return subscribeToDebrief(listener); }
export function getAnalyticsMetricDefinitions() { return registry.definitions; }
