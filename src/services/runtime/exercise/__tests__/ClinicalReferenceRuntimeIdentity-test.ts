import { assertActiveRuntimeExerciseIdentity } from "../ClinicalReferenceRuntimeService";

describe("clinical reference Runtime exercise identity", () => {
  test("accepts Runtime bindings belonging to the current exercise", () => {
    expect(() => assertActiveRuntimeExerciseIdentity(
      [{ exerciseId: "EX-B" }, { exerciseId: "EX-B" }],
      "EX-B",
    )).not.toThrow();
  });

  test("classifies a cross-exercise capture as identity mismatch before clock validation", () => {
    expect(() => assertActiveRuntimeExerciseIdentity(
      [{ exerciseId: "EX-A" }],
      "EX-B",
    )).toThrow("RUNTIME_CHECKPOINT_EXERCISE_MISMATCH");
  });
});
