import {
  getExerciseSession,
  setExerciseMinute,
} from "@/repositories/ExerciseSessionRepository";
import { runScenarioEvents } from "@/services/ScenarioEngine";
import { notifySync } from "@/services/SyncService";

export function tickExerciseClock(): void {

  const session = getExerciseSession();

  console.log(

    "TICK SERVICE",

    session.state,

    session.currentMinute,

    session.speed

  );

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

  console.log(
    "ADVANCE BEFORE",
    session.currentMinute,
    "ADD",
    minutes
  );

  const newMinute = session.currentMinute + minutes;

  setExerciseMinute(newMinute);

  console.log(
    "ADVANCE AFTER",
    getExerciseSession().currentMinute
  );

  runScenarioEvents(newMinute);
  notifySync();
}