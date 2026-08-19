import { getExerciseStatusPresentation } from "../ExerciseStatusCard";
import { canPrepareNewExercise, getPrepareNewExercisePresentation } from "../PrepareNewExerciseCard";
import type { CanonicalExerciseSnapshot, ExerciseLifecycleState } from "@/models/exercise/CanonicalExerciseSnapshot";

const snapshot = (lifecycleState: ExerciseLifecycleState): CanonicalExerciseSnapshot => ({
  exerciseId: "EX-CONSISTENCY", lifecycleState, simulationTimeSec: 1234, speed: 1, version: 8,
});

describe("canonical exercise lifecycle projection", () => {
  test.each(["READY", "RUNNING", "PAUSED", "COMPLETED"] as const)("CM and EXCON preserve %s", lifecycleState => {
    const canonical = snapshot(lifecycleState);
    expect(getExerciseStatusPresentation(canonical).lifecycleState).toBe(canonical.lifecycleState);
  });

  test("COMPLETED exercise remains terminal while Runtime is stopped", () => {
    const presentation = getExerciseStatusPresentation(snapshot("COMPLETED"));
    expect(presentation).toMatchObject({ lifecycleState: "COMPLETED", lifecycleLabel: "Lõpetatud", runtimeExecutionState: "STOPPED" });
    expect(canPrepareNewExercise("COMPLETED")).toBe(true);
    expect(getPrepareNewExercisePresentation("COMPLETED", true, false)).toMatchObject({ visible: true, enabled: true });
  });

  test.each(["RUNNING", "PAUSED"] as const)("%s blocks preparation", lifecycleState => {
    expect(canPrepareNewExercise(lifecycleState)).toBe(false);
    expect(getPrepareNewExercisePresentation(lifecycleState, true, false)).toMatchObject({ visible: false, enabled: false });
  });
});
