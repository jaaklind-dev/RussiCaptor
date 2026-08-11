import type { CompletedExerciseArchive } from "../CompletedExerciseArchiveService";
import {
  clearCompletedExerciseArchives,
  getCompletedExerciseArchive,
  getCompletedExerciseArchives,
  restoreCompletedExerciseArchives,
  storeCompletedExerciseArchive,
} from "../CompletedExerciseArchiveService";

function archive(exerciseId: string): CompletedExerciseArchive {
  return {
    exerciseId,
    snapshot: {
      exerciseId,
      lifecycleState: "COMPLETED",
      simulationTimeSec: 45,
      speed: 1,
      version: 4,
      clockVersion: 1,
      clockInitializedAtSimulationTimeSec: 0,
    },
    debrief: { reportId: `debrief-${exerciseId}` },
    analytics: { reportId: `analytics-${exerciseId}` },
  } as unknown as CompletedExerciseArchive;
}

describe("completed exercise archives", () => {
  beforeEach(clearCompletedExerciseArchives);

  test("preserves completed evidence immutably and idempotently", () => {
    const first = archive("EX-OLD");
    storeCompletedExerciseArchive(first);

    const duplicate = {
      ...archive("EX-OLD"),
      snapshot: { ...archive("EX-OLD").snapshot, simulationTimeSec: 999 },
    } as CompletedExerciseArchive;
    storeCompletedExerciseArchive(duplicate);

    expect(getCompletedExerciseArchive("EX-OLD")?.snapshot).toMatchObject({
      lifecycleState: "COMPLETED",
      simulationTimeSec: 45,
    });
    expect(Object.isFrozen(getCompletedExerciseArchive("EX-OLD"))).toBe(true);
  });

  test("restores archives in deterministic exercise-id order", () => {
    restoreCompletedExerciseArchives([archive("EX-2"), archive("EX-1")]);

    expect(getCompletedExerciseArchives().map((item) => item.exerciseId)).toEqual([
      "EX-1",
      "EX-2",
    ]);
  });
});
