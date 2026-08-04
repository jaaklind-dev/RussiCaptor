import type { DebriefReport } from "@/services/debrief/DebriefModel";

export type AnalyticsCategory = "EXERCISE_FLOW" | "PATIENT_CARE" | "OWNERSHIP" | "INTERVENTIONS" | "MEDICATIONS" | "DIAGNOSTICS" | "RESOURCES" | "COMMANDS" | "SYSTEM";
export type MetricUnit = "SECONDS" | "COUNT" | "PERCENT" | "BOOLEAN" | "RATIO" | "TEXT" | "NONE";
export type MetricScope = "EXERCISE" | "PATIENT" | "CASE_MANAGER" | "RESOURCE" | "COMMAND";
export type MetricStatus = "VALUE" | "NOT_APPLICABLE" | "UNAVAILABLE" | "ERROR";

export type MetricDefinition = Readonly<{ metricId: string; version: string; name: string; description: string; category: AnalyticsCategory; unit: MetricUnit; scope: MetricScope; providerId: string; tags?: readonly string[] }>;
export type MetricEvidenceReference = Readonly<{ sourceType: "TIMELINE_EVENT" | "PATIENT_SUMMARY" | "EXERCISE_SUMMARY" | "AUDIT_EVENT" | "DEBRIEF_FIELD"; sourceId?: string; patientId?: string; simulationTimeSec?: number; fieldPath?: string }>;
type MetricResultBase = Readonly<{ metricId: string; metricVersion: string; providerId: string; scope: MetricScope; subjectId?: string; category: AnalyticsCategory; evidence: readonly MetricEvidenceReference[] }>;
export type NumericMetricResult = MetricResultBase & Readonly<{ status: "VALUE"; value: number; unit: Exclude<MetricUnit, "BOOLEAN" | "TEXT" | "NONE"> }>;
export type BooleanMetricResult = MetricResultBase & Readonly<{ status: "VALUE"; value: boolean; unit: "BOOLEAN" }>;
export type TextMetricResult = MetricResultBase & Readonly<{ status: "VALUE"; value: string; unit: "TEXT" }>;
export type NonValueMetricResult = MetricResultBase & Readonly<{ status: "NOT_APPLICABLE" | "UNAVAILABLE" | "ERROR"; reasonCode: string; message: string; unit: MetricUnit }>;
export type MetricResult = NumericMetricResult | BooleanMetricResult | TextMetricResult | NonValueMetricResult;

export type AnalyticsDiagnostic = Readonly<{ severity: "INFO" | "WARNING" | "ERROR"; code: string; providerId?: string; metricId?: string; message: string }>;
export type AnalyticsPrecisionPolicy = Readonly<{ secondsDecimals: number; percentDecimals: number; ratioDecimals: number; genericDecimals: number }>;
export type AnalyticsConfiguration = Readonly<{ enabledProviderIds?: readonly string[]; enabledMetricIds?: readonly string[]; precisionPolicy: AnalyticsPrecisionPolicy }>;
export type AnalyticsEvaluationContext = Readonly<{ debrief: DebriefReport; exerciseId: string; sourceDebriefHash: string; configuration: AnalyticsConfiguration }>;
export interface AnalyticsMetricProvider { readonly providerId: string; readonly version: string; getDefinitions(): readonly MetricDefinition[]; evaluate(context: AnalyticsEvaluationContext): readonly MetricResult[]; }
export type AnalyticsCategorySummary = Readonly<{ category: AnalyticsCategory; metricCount: number; valueCount: number; unavailableCount: number; notApplicableCount: number; errorCount: number }>;
export type AnalyticsPackageMetadata = Readonly<{ packageId: string; packageVersion: string; packageHash: string }>;
export type AnalyticsReport = Readonly<{ analyticsVersion: 1; exerciseId: string; sourceDebriefHash: string; generatedAtSimulationTimeSec: number; providerRegistryVersion: string; metrics: readonly MetricResult[]; categories: readonly AnalyticsCategorySummary[]; diagnostics: readonly AnalyticsDiagnostic[]; analyticsHash: string; exercisePackage?: AnalyticsPackageMetadata }>;
export type AnalyticsFilters = Readonly<{ category?: AnalyticsCategory; providerId?: string; scope?: MetricScope; status?: MetricStatus; patientId?: string; search?: string }>;
