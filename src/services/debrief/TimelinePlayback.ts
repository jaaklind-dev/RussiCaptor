import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";

export function timelineAt(events: readonly ExerciseTimelineEvent[], simulationTimeSec: number): readonly ExerciseTimelineEvent[] {
  return Object.freeze(events.filter(event => event.simulationTimeSec <= simulationTimeSec));
}

