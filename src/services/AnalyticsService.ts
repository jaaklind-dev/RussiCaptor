import { getDebriefReport, getDebriefVersion, subscribeToDebrief } from "./DebriefService";
import { generateAnalytics } from "./analytics/AnalyticsEngine";
import { AnalyticsProviderRegistry } from "./analytics/AnalyticsProviderRegistry";
import { DEFAULT_ANALYTICS_PRECISION } from "./analytics/AnalyticsPrecision";
import { ExerciseSummaryMetricProvider } from "./analytics/providers/ExerciseSummaryMetricProvider";

const registry = new AnalyticsProviderRegistry([ExerciseSummaryMetricProvider]);
let version = ""; let report: ReturnType<typeof generateAnalytics> | undefined;
export function getAnalyticsReport() { const next = getDebriefVersion(); if (!report || version !== next) { report = generateAnalytics(getDebriefReport(), registry, Object.freeze({ precisionPolicy: DEFAULT_ANALYTICS_PRECISION })); version = next; } return report; }
export function getAnalyticsVersion(): string { return getDebriefVersion(); }
export function subscribeToAnalytics(listener: () => void): () => void { return subscribeToDebrief(listener); }
export function getAnalyticsMetricDefinitions() { return registry.definitions; }
