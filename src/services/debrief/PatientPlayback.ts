import type { DebriefReport, PatientPlaybackView, PlaybackCursor } from "./DebriefModel";
import { timelineAt } from "./TimelinePlayback";

export function patientPlayback(report: DebriefReport, patientId: string, cursor: PlaybackCursor): PatientPlaybackView | undefined {
  const patient = report.patients.find(item => item.patientId === patientId);
  if (!patient) return undefined;
  return Object.freeze({ patient, events: Object.freeze(timelineAt(report.timeline, cursor.simulationTimeSec).filter(event => event.patientId === patientId)), processes: patient.processes, simulationTimeSec: cursor.simulationTimeSec });
}

