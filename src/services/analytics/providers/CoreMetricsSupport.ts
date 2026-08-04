import type { AnalyticsCategory, AnalyticsEvaluationContext, MetricDefinition, MetricEvidenceReference, MetricResult, MetricScope, MetricUnit } from "@/models/analytics/Analytics";
import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { DebriefReport, PatientDebriefSummary } from "@/services/debrief/DebriefModel";

export type CoreMetricIndex = Readonly<{ timeline: readonly ExerciseTimelineEvent[]; byPatient: ReadonlyMap<string, readonly ExerciseTimelineEvent[]>; byCategory: ReadonlyMap<string, readonly ExerciseTimelineEvent[]>; controlEvents: readonly ExerciseTimelineEvent[]; assignmentEvents: readonly ExerciseTimelineEvent[]; transferEvents: readonly ExerciseTimelineEvent[]; patients: ReadonlyMap<string, PatientDebriefSummary> }>;
const cache = new WeakMap<DebriefReport, CoreMetricIndex>();
export function coreMetricIndex(debrief: DebriefReport): CoreMetricIndex {
  const cached = cache.get(debrief); if (cached) return cached;
  const patientBuckets = new Map<string, ExerciseTimelineEvent[]>(); const categoryBuckets = new Map<string, ExerciseTimelineEvent[]>();
  for (const event of debrief.timeline) { if (event.patientId) { const bucket = patientBuckets.get(event.patientId) ?? []; bucket.push(event); patientBuckets.set(event.patientId, bucket); } const category = categoryBuckets.get(event.category) ?? []; category.push(event); categoryBuckets.set(event.category, category); }
  const freezeMap = (map: Map<string, ExerciseTimelineEvent[]>) => new Map([...map].map(([key, value]) => [key, Object.freeze(value)]));
  const index: CoreMetricIndex = Object.freeze({ timeline: debrief.timeline, byPatient: freezeMap(patientBuckets), byCategory: freezeMap(categoryBuckets), controlEvents: Object.freeze(debrief.timeline.filter(event => typeof event.metadata?.commandType === "string")), assignmentEvents: Object.freeze(debrief.timeline.filter(event => event.type === "ASSIGNMENT")), transferEvents: Object.freeze(debrief.timeline.filter(event => event.type === "TRANSFER")), patients: new Map(debrief.patients.map(patient => [patient.patientId, patient])) }); cache.set(debrief, index); return index;
}

export const definition = (providerId: string, metricId: string, name: string, description: string, category: AnalyticsCategory, unit: MetricUnit, scope: MetricScope): MetricDefinition => Object.freeze({ providerId, metricId, version: "1.0.0", name, description, category, unit, scope });
export const evidence = (sourceType: MetricEvidenceReference["sourceType"], fieldPath?: string, sourceId?: string, patientId?: string, simulationTimeSec?: number): MetricEvidenceReference => Object.freeze({ sourceType, fieldPath, sourceId, patientId, simulationTimeSec });
type Value = number | boolean | string;
export function valueResult(def: MetricDefinition, value: Value, evidenceItems: readonly MetricEvidenceReference[], subjectId?: string): MetricResult { return Object.freeze({ metricId: def.metricId, metricVersion: def.version, providerId: def.providerId, category: def.category, scope: def.scope, subjectId, status: "VALUE", value, unit: def.unit === "BOOLEAN" ? "BOOLEAN" : def.unit === "TEXT" ? "TEXT" : def.unit as "SECONDS" | "COUNT" | "PERCENT" | "RATIO", evidence: Object.freeze([...evidenceItems]) }) as MetricResult; }
export function unavailableResult(def: MetricDefinition, reasonCode: string, message: string, evidenceItems: readonly MetricEvidenceReference[], subjectId?: string, status: "UNAVAILABLE" | "NOT_APPLICABLE" = "UNAVAILABLE"): MetricResult { return Object.freeze({ metricId: def.metricId, metricVersion: def.version, providerId: def.providerId, category: def.category, scope: def.scope, subjectId, status, reasonCode, message, unit: def.unit, evidence: Object.freeze([...evidenceItems]) }); }
export const legacyDuration = (context: AnalyticsEvaluationContext) => context.debrief.clockMigrationStatus !== "CANONICAL";
export const patientEvidence = (patientId: string) => [evidence("PATIENT_SUMMARY", `patients[${patientId}]`, patientId, patientId)];
export const eventEvidence = (events: readonly ExerciseTimelineEvent[]) => events.map(event => evidence(event.category === "AUDIT" ? "AUDIT_EVENT" : "TIMELINE_EVENT", undefined, event.id, event.patientId, event.simulationTimeSec));

