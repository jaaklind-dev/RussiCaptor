import type { CompletedExerciseArchive } from "../CompletedExerciseArchiveService";
import {
  clearCompletedExerciseArchives,
  getCompletedExerciseArchive,
  getCompletedExerciseArchives,
  getPendingCompletedExerciseArchives,
  markCompletedExerciseArchiveDurable,
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

  test("keeps restored legacy archives pending until their historical rows are durable", () => {
    restoreCompletedExerciseArchives([archive("EX-2"), archive("EX-1")]);
    markCompletedExerciseArchiveDurable("EX-1");

    restoreCompletedExerciseArchives([archive("EX-2"), archive("EX-1")]);

    expect(getPendingCompletedExerciseArchives().map(item => item.exerciseId)).toEqual(["EX-2"]);
    clearCompletedExerciseArchives();
    expect(getPendingCompletedExerciseArchives()).toEqual([]);
  });

  test("remembers terminal durability when cloud persistence precedes local archival", () => {
    markCompletedExerciseArchiveDurable("EX-COMPLETED");
    storeCompletedExerciseArchive(archive("EX-COMPLETED"));

    expect(getCompletedExerciseArchive("EX-COMPLETED")).toBeDefined();
    expect(getPendingCompletedExerciseArchives()).toEqual([]);
  });
});
