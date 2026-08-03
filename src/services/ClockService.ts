import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { runScenarioEvents } from "@/services/ScenarioEngine";
import { notifySync } from "@/services/SyncService";
import { advanceExerciseClockTargets } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";

export function tickExerciseClock(): void {
  advanceExerciseClockByWallSeconds(1);
}

export function advanceExerciseClockByWallSeconds(wallSeconds: number): void {
  const current = getCanonicalExerciseSnapshot();
  if (current.lifecycleState !== "RUNNING" || !Number.isFinite(wallSeconds) || wallSeconds <= 0) return;
  const simulationTimeSec = current.simulationTimeSec + wallSeconds * current.speed;
  // Version is the control-plane concurrency token. Clock ticks update time, not command ordering.
  replaceCanonicalExerciseSnapshot({ ...current, simulationTimeSec });
  advanceExerciseClockTargets(current.simulationTimeSec, simulationTimeSec);
  runScenarioEvents(simulationTimeSec / 60);
  notifySync("local");
}

export function advanceExerciseMinutes(minutes: number): void {
  const current = getCanonicalExerciseSnapshot();
  const simulationTimeSec = current.simulationTimeSec + minutes * 60;
  replaceCanonicalExerciseSnapshot({ ...current, simulationTimeSec });
  advanceExerciseClockTargets(current.simulationTimeSec, simulationTimeSec);
  runScenarioEvents(simulationTimeSec / 60);
  notifySync("local");
}
