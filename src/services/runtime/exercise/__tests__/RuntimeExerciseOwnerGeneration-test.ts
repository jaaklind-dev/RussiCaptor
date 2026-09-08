import { RuntimeExerciseOwnerGeneration } from "../RuntimeExerciseOwnerGeneration";
import {
  clearExerciseRuntimeOwner,
  getExerciseRuntimeOwner,
  registerExerciseRuntimeOwner,
  type ExerciseRuntimeOwner,
} from "../ExerciseRuntimeOwnerRegistry";
import { initializeAuthoritativeExerciseRuntime } from "../AuthoritativeExerciseRuntime";

const owner = (exerciseId: string): ExerciseRuntimeOwner => ({
  exerciseId,
  apply: jest.fn() as ExerciseRuntimeOwner["apply"],
});

describe("Runtime exercise owner generation", () => {
  beforeEach(clearExerciseRuntimeOwner);
  afterEach(clearExerciseRuntimeOwner);

  test("establishes one owner without dashboard participation", () => {
    const created: ExerciseRuntimeOwner[] = [];
    const generation = new RuntimeExerciseOwnerGeneration("EX-1", () => true, exerciseId => {
      const value = owner(exerciseId);
      created.push(value);
      return value;
    });

    expect(generation.establish()).toBe(true);
    expect(generation.establish()).toBe(true);
    expect(created).toHaveLength(1);
    expect(generation.isReady()).toBe(true);
    expect(getExerciseRuntimeOwner()).toBe(created[0]);
  });

  test("does not let a stale generation install or clear the current owner", () => {
    let firstCurrent = true;
    const first = new RuntimeExerciseOwnerGeneration("EX-1", () => firstCurrent, owner);
    expect(first.establish()).toBe(true);

    firstCurrent = false;
    const second = new RuntimeExerciseOwnerGeneration("EX-2", () => true, owner);
    expect(second.establish()).toBe(true);
    const current = getExerciseRuntimeOwner();
    expect(current?.exerciseId).toBe("EX-2");
    expect(first.establish()).toBe(false);
    first.release();
    expect(getExerciseRuntimeOwner()).toBe(current);
  });

  test("release unregisters only its own active owner", () => {
    const generation = new RuntimeExerciseOwnerGeneration("EX-1", () => true, owner);
    expect(generation.establish()).toBe(true);
    const replacement = owner("EX-2");
    registerExerciseRuntimeOwner(replacement);
    generation.release();
    expect(getExerciseRuntimeOwner()).toBe(replacement);
  });

  test("a dashboard mounting later adopts rather than replaces the writer owner", () => {
    const generation = new RuntimeExerciseOwnerGeneration("EX-1", () => true, owner);
    expect(generation.establish()).toBe(true);
    const writerOwner = getExerciseRuntimeOwner();
    initializeAuthoritativeExerciseRuntime("EX-1");
    expect(getExerciseRuntimeOwner()).toBe(writerOwner);
    expect(generation.isReady()).toBe(true);
  });
});
