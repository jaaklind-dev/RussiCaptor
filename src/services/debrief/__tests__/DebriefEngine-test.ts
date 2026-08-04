import type { Patient } from "@/models/Patient";
import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import { reconstructDebrief } from "../DebriefEngine";
import { filterDebriefPatients } from "../DebriefSelectors";
import { advance, createPlaybackCursor, jumpToEvent, jumpToPatient, play, seek } from "../PlaybackController";
import { patientPlayback } from "../PatientPlayback";
import { timelineAt } from "../TimelinePlayback";
import { stableJson } from "@/utils/stableJson";

const patient = (id: string, status: Patient["status"] = "Active") => ({
  id, name: `Patient ${id}`, location: "EMO", status,
} as Pick<Patient, "id" | "name" | "location" | "status">);

const event = (id: string, simulationTimeSec: number, patientId = "PT-001", type = "INTERVENTION", category: ExerciseTimelineEvent["category"] = "PATIENT"): ExerciseTimelineEvent => Object.freeze({
  id, exerciseId: "EX-1", simulationTimeSec, sequenceNumber: Number(id.replace(/\D/g, "")) || 1,
  category, type, severity: "INFO", patientId, title: `${type} ${id}`,
});

const source = () => ({
  exercise: { exerciseId: "EX-1", lifecycleState: "COMPLETED" as const, simulationTimeSec: 120, speed: 1 as const, version: 4, updatedAtWallClock: "2026-08-04T12:00:00Z" },
  patients: [{ patient: patient("PT-001", "Completed") }, { patient: patient("PT-002") }],
  timeline: [event("E-1", 10, "PT-001", "INTERVENTION"), event("E-2", 20, "PT-001", "MEDICATION"), event("E-3", 30, "PT-002", "ORDER"), event("E-4", 40, "PT-002", "ExerciseCompleted", "EXERCISE")],
  replayEvents: [{ type: "ENGINE_TICK", simulationTimeSec: 10 }],
});

describe("WP-24 canonical Debrief Engine", () => {
  it("reconstructs an immutable factual report without scoring", () => {
    const report = reconstructDebrief(source());
    expect(report).toMatchObject({ exerciseId: "EX-1", patientCount: 2, completedPatients: 1, timelineLength: 4, exerciseState: "COMPLETED" });
    expect(report.patients[0]).toMatchObject({ patientId: "PT-001", outcome: "COMPLETED_SCENARIO" });
    expect(report.patients[0].interventions).toHaveLength(1);
    expect(report.patients[0].medications).toHaveLength(1);
    expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.patients)).toBe(true); expect(Object.isFrozen(report.timeline[0])).toBe(true);
    expect(report).not.toHaveProperty("score"); expect(report).not.toHaveProperty("grade"); expect(report).not.toHaveProperty("kpis");
  });

  it("is replay deterministic and excludes wall-clock metadata from its source hash", () => {
    const first = reconstructDebrief(source());
    const secondSource = source(); secondSource.exercise.updatedAtWallClock = "2030-01-01T00:00:00Z";
    const second = reconstructDebrief(secondSource);
    expect(second.generatedFromReplayHash).toBe(first.generatedFromReplayHash);
    expect(stableJson(second)).toBe(stableJson(first));
  });

  it("supports immutable timeline and patient playback without driving runtime", () => {
    const report = reconstructDebrief(source()); const before = stableJson(report);
    let cursor = createPlaybackCursor(); cursor = seek(cursor, 20, 120); cursor = jumpToEvent(cursor, report.timeline[1]); cursor = jumpToPatient(cursor, "PT-001");
    expect(timelineAt(report.timeline, cursor.simulationTimeSec).map(item => item.id)).toEqual(["E-1", "E-2"]);
    expect(patientPlayback(report, "PT-001", cursor)?.events).toHaveLength(2);
    expect(advance(play(cursor), 200, 120)).toMatchObject({ simulationTimeSec: 120, playing: false });
    expect(stableJson(report)).toBe(before); expect(Object.isFrozen(cursor)).toBe(true);
  });

  it("filters patient projection only", () => {
    const report = reconstructDebrief(source());
    expect(filterDebriefPatients(report, { search: "pt-002", outcome: "STILL_ACTIVE" }).map(item => item.patientId)).toEqual(["PT-002"]);
    expect(filterDebriefPatients(report, { exercisePhase: "RUNNING" })).toEqual([]);
  });

  it("reconstructs 100 patients and 10,000 events within a bounded linear workload", () => {
    const patients = Array.from({ length: 100 }, (_, index) => ({ patient: patient(`PT-${String(index + 1).padStart(3, "0")}`) }));
    const timeline = Array.from({ length: 10_000 }, (_, index) => event(`E-${index + 1}`, index, `PT-${String(index % 100 + 1).padStart(3, "0")}`));
    const started = Date.now(); const report = reconstructDebrief({ ...source(), patients, timeline });
    expect(report.patientCount).toBe(100); expect(report.timelineLength).toBe(10_000); expect(Date.now() - started).toBeLessThan(2_000);
  });
});

