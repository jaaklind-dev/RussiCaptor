import type { AggregationEvent, NumericRange, ProcessOutput, RuntimeVitalAttribution } from "@/models/RuntimeAggregation";
import type { PatientVitalContributor, VitalSignKey } from "@/models/VitalSign";

const limits = { hrDelta: 35, rrDelta: 12, sbpSupport: 20, temperatureDelta: 2 } as const;
type PriorityField = "vitalPriority" | "respiratoryPriority" | "oxygenationPriority";

const midpoint = (range: NumericRange) => (range.min + range.max) / 2;
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
const score = (output: ProcessOutput, priority: PriorityField) => (output[priority] ?? 10) * output.globalSeverityScore;

function sorted(outputs: ProcessOutput[], priority: PriorityField, secondary?: (a: ProcessOutput, b: ProcessOutput) => number) {
  return [...outputs].sort((a, b) => score(b, priority) - score(a, priority) || (secondary?.(a, b) ?? 0) || a.processId.localeCompare(b.processId));
}

function contribution(vital: VitalSignKey, value: number, source: string): PatientVitalContributor {
  return { contributorId: `legacy:${source}:${vital}`, sourceType: "PATIENT_PROCESS", sourceId: source,
    layer: "PROCESS", vital, operation: "TARGET", value };
}

function capped(values: number[], limit: number, field: string, events: AggregationEvent[]) {
  const raw = values.reduce((sum, value) => sum + value, 0); const applied = clamp(raw, limit);
  if (raw !== applied) events.push({ eventType: "AGGREGATION_CAP_APPLIED", field, details: { raw, applied, cap: limit } });
  return applied;
}

/** Converts frozen pre-WP16 ProcessOutput fields into the contributor contract. */
export function adaptLegacyVitalContributors(outputs: ProcessOutput[]): {
  contributors: PatientVitalContributor[]; attribution: RuntimeVitalAttribution; events: AggregationEvent[];
} {
  const contributors: PatientVitalContributor[] = [];
  const attribution: RuntimeVitalAttribution = {};
  const events: AggregationEvent[] = [];
  const range = (field: "hrTargetRange" | "sbpTargetRange" | "dbpTargetRange" | "rrTargetRange", priority: PriorityField, low = false) =>
    sorted(outputs.filter(item => item[field]), priority, low ? (a, b) => midpoint(a[field]!) - midpoint(b[field]!) : undefined)[0];

  const hr = range("hrTargetRange", "vitalPriority");
  if (hr?.hrTargetRange) { const other = outputs.filter(x => x.processId !== hr.processId && Number.isFinite(x.hrDelta));
    const delta = capped(other.map(x => x.hrDelta!), limits.hrDelta, "hr", events);
    contributors.push(contribution("heartRate", midpoint(hr.hrTargetRange) + delta, hr.processId));
    attribution.hr = { primaryProcessId: hr.processId, contributorProcessIds: other.map(x => x.processId), rawContributions: other.map(x => x.hrDelta!), appliedContribution: delta }; }
  const sbp = range("sbpTargetRange", "vitalPriority", true);
  if (sbp?.sbpTargetRange) { const other = outputs.filter(x => x.processId !== sbp.processId && Number.isFinite(x.sbpSupportDelta));
    const delta = capped(other.map(x => x.sbpSupportDelta!), limits.sbpSupport, "sbp", events);
    contributors.push(contribution("systolicBp", midpoint(sbp.sbpTargetRange) + delta, sbp.processId));
    attribution.sbp = { primaryProcessId: sbp.processId, contributorProcessIds: other.map(x => x.processId), rawContributions: other.map(x => x.sbpSupportDelta!), appliedContribution: delta }; }
  const dbp = range("dbpTargetRange", "vitalPriority", true);
  if (dbp?.dbpTargetRange) { contributors.push(contribution("diastolicBp", midpoint(dbp.dbpTargetRange), dbp.processId)); attribution.dbp = { primaryProcessId: dbp.processId, contributorProcessIds: [] }; }
  else if (sbp?.sbpTargetRange) { const value = midpoint(sbp.sbpTargetRange); contributors.push(contribution("diastolicBp", Math.min(value - 1, value * 0.6), "SYSTEM_DERIVED")); attribution.dbp = { primaryProcessId: "SYSTEM_DERIVED", contributorProcessIds: [] }; }
  const rr = range("rrTargetRange", "respiratoryPriority");
  if (rr?.rrTargetRange) { const other = outputs.filter(x => x.processId !== rr.processId && Number.isFinite(x.rrDelta));
    const delta = capped(other.map(x => x.rrDelta!), limits.rrDelta, "rr", events);
    contributors.push(contribution("respiratoryRate", midpoint(rr.rrTargetRange) + delta, rr.processId));
    attribution.rr = { primaryProcessId: rr.processId, contributorProcessIds: other.map(x => x.processId), rawContributions: other.map(x => x.rrDelta!), appliedContribution: delta }; }
  const spo2 = [...outputs].filter(x => Number.isFinite(x.spo2Ceiling)).sort((a,b) => a.spo2Ceiling! - b.spo2Ceiling! || score(b,"oxygenationPriority") - score(a,"oxygenationPriority") || a.processId.localeCompare(b.processId))[0];
  if (spo2) { contributors.push(contribution("spo2", spo2.spo2Ceiling!, spo2.processId)); attribution.spo2 = { primaryProcessId: spo2.processId, contributorProcessIds: [] }; }
  const temp = sorted(outputs.filter(x => Number.isFinite(x.temperatureTarget)), "vitalPriority")[0];
  if (temp?.temperatureTarget !== undefined) { const deltaSources = outputs.filter(x => Number.isFinite(x.temperatureDelta)); const delta = capped(deltaSources.map(x=>x.temperatureDelta!), limits.temperatureDelta, "temperature", events);
    contributors.push(contribution("temperature", temp.temperatureTarget + delta, temp.processId)); attribution.temperature = { primaryProcessId: temp.processId, contributorProcessIds: deltaSources.map(x=>x.processId), rawContributions: deltaSources.map(x=>x.temperatureDelta!), appliedContribution: delta }; }
  const crt = [...outputs].filter(x => Number.isFinite(x.crtTarget)).sort((a,b)=>b.crtTarget!-a.crtTarget! || a.processId.localeCompare(b.processId))[0];
  if (crt) { contributors.push(contribution("crt", crt.crtTarget!, crt.processId)); attribution.crt = { primaryProcessId: crt.processId, contributorProcessIds: [] }; }
  const arrest = outputs.find(x => x.statusProposal === "Arrest" || x.mentalStatusCeiling === "Arrest");
  const gcs = arrest ? { processId: arrest.processId, value: 3 } : outputs.filter(x => Number.isFinite(x.gcsCeiling))
    .map(x => ({ processId:x.processId, value:x.gcsCeiling! })).sort((a,b)=>a.value-b.value || a.processId.localeCompare(b.processId))[0];
  if (gcs) { contributors.push(contribution("gcs", gcs.value, gcs.processId)); attribution.gcs = { primaryProcessId:gcs.processId, contributorProcessIds:[] }; }
  return { contributors, attribution, events };
}
