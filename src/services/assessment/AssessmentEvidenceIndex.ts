import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
export const compareEvidenceEvents = (a: ExerciseTimelineEvent, b: ExerciseTimelineEvent): number => a.simulationTimeSec - b.simulationTimeSec || a.sequenceNumber - b.sequenceNumber || a.id.localeCompare(b.id);
/** A single canonical indexing pass avoids scanning the full Timeline for every expectation. */
export class AssessmentEvidenceIndex {
  readonly timeline: readonly ExerciseTimelineEvent[]; readonly byType: ReadonlyMap<string, readonly ExerciseTimelineEvent[]>; readonly byPatient: ReadonlyMap<string, readonly ExerciseTimelineEvent[]>;
  private readonly queries = new Map<string, readonly ExerciseTimelineEvent[]>();
  constructor(events: readonly ExerciseTimelineEvent[]) { this.timeline = Object.freeze([...events].sort(compareEvidenceEvents)); const types = new Map<string, ExerciseTimelineEvent[]>(); const patients = new Map<string, ExerciseTimelineEvent[]>(); for (const event of this.timeline) { const type = event.type.toUpperCase(); types.set(type, [...(types.get(type) ?? []), event]); if (event.patientId) patients.set(event.patientId, [...(patients.get(event.patientId) ?? []), event]); } this.byType = types; this.byPatient = patients; }
  events(patientId?: string): readonly ExerciseTimelineEvent[] { return patientId ? this.byPatient.get(patientId) ?? [] : this.timeline; }
  select(key: string, patientId: string | undefined, predicate: (event: ExerciseTimelineEvent) => boolean): readonly ExerciseTimelineEvent[] { const cacheKey = `${patientId ?? "EXERCISE"}:${key}`; const cached = this.queries.get(cacheKey); if (cached) return cached; const result = Object.freeze(this.events(patientId).filter(predicate)); this.queries.set(cacheKey, result); return result; }
}
