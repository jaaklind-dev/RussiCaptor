import { resolveCurrentExercise, resolveScopedExconExercise, resolveScopedOperatorExercise, type CurrentExerciseCandidate } from "../CurrentExerciseSelectionService";

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

describe("assignment-scoped EXCON exercise selection", () => {
  const builder = candidate("EX-BUILDER", "READY", "2026-10-09T16:36:19Z");
  const other = candidate("EX-OTHER", "READY", "2026-10-10T10:00:00Z");

  test("EXCON-SEL-01/02 one assignment selects its exact READY instance, not the newest row", () => {
    expect(resolveScopedExconExercise([other, builder], [builder.exerciseId]))
      .toMatchObject({ status: "SELECTED", candidate: { exerciseId: builder.exerciseId } });
  });

  test("EXCON-SEL-03 package/catalog ordering has no input to instance selection", () => {
    for (const rows of [[builder, other], [other, builder]]) {
      expect(resolveScopedExconExercise(rows, [builder.exerciseId]))
        .toMatchObject({ status: "SELECTED", candidate: { exerciseId: builder.exerciseId } });
    }
  });

  test("EXCON-SEL-04 stale remembered instance cannot override a scoped assignment", () => {
    expect(resolveScopedExconExercise([other, builder], [builder.exerciseId], other.exerciseId))
      .toMatchObject({ status: "SELECTED", candidate: { exerciseId: builder.exerciseId } });
  });

  test("EXCON-SEL-08 multiple assignments require an explicit exercise-instance choice", () => {
    expect(resolveScopedExconExercise([other, builder], [builder.exerciseId, other.exerciseId]))
      .toMatchObject({ status: "CONFLICT", exerciseIds: [other.exerciseId, builder.exerciseId] });
    expect(resolveScopedExconExercise([other, builder], [builder.exerciseId, other.exerciseId], builder.exerciseId))
      .toMatchObject({ status: "SELECTED", candidate: { exerciseId: builder.exerciseId } });
  });

  test("missing assigned instance fails closed instead of choosing a demo or unrelated READY row", () => {
    expect(resolveScopedExconExercise([other], [builder.exerciseId])).toEqual({ status: "NONE" });
  });
});

test("CM-SEL-01 discovery uses the assigned instance despite another newer active exercise", () => {
  const assigned = candidate("EX-CM", "PAUSED", "2026-10-09T16:36:19Z");
  const unrelated = candidate("EX-DEMO", "READY", "2026-10-10T10:00:00Z");
  expect(resolveScopedOperatorExercise([unrelated, assigned], [assigned.exerciseId]))
    .toMatchObject({ status: "SELECTED", candidate: { exerciseId: assigned.exerciseId } });
});
