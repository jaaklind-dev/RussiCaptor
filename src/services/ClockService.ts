import {
  getExerciseSession,
  setExerciseMinute,
} from "@/repositories/ExerciseSessionRepository";

import { notifySync } from "@/services/SyncService";
import { runScenarioEvents } from "@/services/ScenarioEngine";
export function tickExerciseClock(): void {
   const session = getExerciseSession();

   if (session.state !== "running") {
     return;
   }

   const newMinute = session.currentMinute + minutes;

   setExerciseMinute(newMinute);

   runScenarioEvents(newMinute);

   notifySync();
 }