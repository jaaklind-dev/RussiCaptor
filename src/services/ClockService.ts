import {
  getExerciseSession,
  setExerciseMinute,
} from "@/repositories/ExerciseSessionRepository";

import { notifySync } from "@/services/SyncService";
import { runScenarioEvents } from "@/services/ScenarioEngine";
export function tickExerciseClock(patientId: string): void {
  const session = getExerciseSession();

  if (session.state !== "running") {
    return;
  }

  setExerciseMinute(session.currentMinute + session.speed);

  runScenarioEvents(
    patientId,
    session.currentMinute + session.speed
  );

  notifySync();
}