import type { ExerciseTimelineEvent, ExerciseTimelineFilters, ExerciseTimelineGroup, ExerciseTimelineGroupSection } from "@/models/exercise/ExerciseTimelineEvent";

const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();
export function filterExerciseTimeline(events: readonly ExerciseTimelineEvent[], filters: ExerciseTimelineFilters): readonly ExerciseTimelineEvent[] {
  const categories = new Set(filters.categories); const severities = new Set(filters.severities);
  const patientId = normalized(filters.patientId); const caseManager = normalized(filters.caseManager); const search = normalized(filters.search);
  return events.filter(event => (!categories.size || categories.has(event.category)) && (!severities.size || severities.has(event.severity))
    && (!patientId || normalized(event.patientId) === patientId) && (!caseManager || normalized(event.issuedBy) === caseManager)
    && (!search || [event.patientId, event.title, event.description, event.issuedBy, event.category].some(value => normalized(value).includes(search))));
}

export function newestExerciseTimelineFirst(events: readonly ExerciseTimelineEvent[]): readonly ExerciseTimelineEvent[] {
  return [...events].sort((a, b) => b.simulationTimeSec - a.simulationTimeSec || b.sequenceNumber - a.sequenceNumber);
}

export function groupExerciseTimeline(events: readonly ExerciseTimelineEvent[], grouping: ExerciseTimelineGroup): readonly ExerciseTimelineGroupSection[] {
  if (grouping === "NONE") return [{ key: "ALL", title: "All events", events }];
  const groups = new Map<string, ExerciseTimelineEvent[]>();
  for (const event of events) {
    const key = grouping === "TODAY" ? "TODAY" : grouping === "SIMULATION_MINUTE" ? String(Math.floor(event.simulationTimeSec / 60))
      : grouping === "PATIENT" ? event.patientId ?? "EXERCISE" : event.category;
    const bucket = groups.get(key) ?? []; bucket.push(event); groups.set(key, bucket);
  }
  return [...groups.entries()].map(([key, sectionEvents]) => ({ key, title: grouping === "TODAY" ? "Today" : grouping === "SIMULATION_MINUTE" ? `T+${key} min` : key, events: sectionEvents }));
}
