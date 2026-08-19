import { resolveCurrentExercise, type CurrentExerciseCandidate } from "../CurrentExerciseSelectionService";

function candidate(exerciseId: string, lifecycleState: "READY" | "RUNNING" | "PAUSED" | "COMPLETED", updatedAt: string): CurrentExerciseCandidate {
  return {
    exerciseId,
    revision: 1,
    updatedAt,
    state: {
      exerciseSession: { exerciseId, lifecycleState, simulationTimeSec: 0, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 },
      patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [], interventions: [], medicationAdministrations: [], vitalSigns: [],
    },
  };
}

describe("canonical current exercise selection", () => {
  test("completed historical A and RUNNING B select B on every surface", () => {
    expect(resolveCurrentExercise([
      candidate("EX-A", "COMPLETED", "2026-08-18T08:00:00Z"),
      candidate("EX-B", "RUNNING", "2026-08-18T07:00:00Z"),
    ])).toMatchObject({ status: "SELECTED", candidate: { exerciseId: "EX-B" } });
  });

  test("authoritative terminal A replaces stale local assumptions and RUNNING B wins", () => {
    expect(resolveCurrentExercise([
      candidate("EX-A", "COMPLETED", "2026-08-18T09:00:00Z"),
      candidate("EX-B", "RUNNING", "2026-08-18T08:00:00Z"),
    ])).toMatchObject({ status: "SELECTED", candidate: { exerciseId: "EX-B" } });
  });

  test("two genuinely active exercises fail closed with a typed conflict", () => {
    expect(resolveCurrentExercise([
      candidate("EX-A", "RUNNING", "2026-08-18T08:00:00Z"),
      candidate("EX-B", "PAUSED", "2026-08-18T09:00:00Z"),
    ])).toMatchObject({ status: "CONFLICT", code: "MULTIPLE_ACTIVE_EXERCISES", exerciseIds: ["EX-B", "EX-A"], candidates: [{ exerciseId: "EX-B" }, { exerciseId: "EX-A" }] });
  });
});
