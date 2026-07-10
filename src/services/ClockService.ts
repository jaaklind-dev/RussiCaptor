import {
  getExerciseSession,
  setExerciseMinute,
} from "@/repositories/ExerciseSessionRepository";
import { runScenarioEvents } from "@/services/ScenarioEngine";
import { notifySync } from "@/services/SyncService";

export function tickExerciseClock(): void {
  const session = getExerciseSession();

  if (session.state !== "running") {
    return;
  }

  const newMinute = session.currentMinute + session.speed;

  setExerciseMinute(newMinute);
  runScenarioEvents(newMinute);
  notifySync();
}

export function advanceExerciseMinutes(minutes: number): void {
  const session = getExerciseSession();

  if (session.state !== "running") {
    return;
  }

  const newMinute = session.currentMinute + minutes;

  setExerciseMinute(newMinute);
  runScenarioEvents(newMinute);
  notifySync();
}