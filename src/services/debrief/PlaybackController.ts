import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { PlaybackCursor } from "./DebriefModel";

export function createPlaybackCursor(simulationTimeSec = 0): PlaybackCursor {
  return Object.freeze({ simulationTimeSec: Math.max(0, simulationTimeSec), playing: false });
}

export function play(cursor: PlaybackCursor): PlaybackCursor { return Object.freeze({ ...cursor, playing: true }); }
export function pause(cursor: PlaybackCursor): PlaybackCursor { return Object.freeze({ ...cursor, playing: false }); }
export function seek(cursor: PlaybackCursor, simulationTimeSec: number, durationSec = Number.MAX_SAFE_INTEGER): PlaybackCursor {
  return Object.freeze({ ...cursor, simulationTimeSec: Math.max(0, Math.min(durationSec, simulationTimeSec)), selectedEventId: undefined });
}
export function jumpToEvent(cursor: PlaybackCursor, event: ExerciseTimelineEvent): PlaybackCursor {
  return Object.freeze({ ...cursor, simulationTimeSec: event.simulationTimeSec, selectedEventId: event.id, selectedPatientId: event.patientId ?? cursor.selectedPatientId });
}
export function jumpToPatient(cursor: PlaybackCursor, patientId: string): PlaybackCursor {
  return Object.freeze({ ...cursor, selectedPatientId: patientId });
}
export function advance(cursor: PlaybackCursor, deltaSec: number, durationSec: number): PlaybackCursor {
  if (!cursor.playing || deltaSec <= 0) return cursor;
  const simulationTimeSec = Math.min(durationSec, cursor.simulationTimeSec + deltaSec);
  return Object.freeze({ ...cursor, simulationTimeSec, playing: simulationTimeSec < durationSec });
}

