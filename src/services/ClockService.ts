import {
  getExerciseSession,
  setExerciseMinute,
} from "@/repositories/ExerciseSessionRepository";

import { notifySync } from "@/services/SyncService";
import { runScenarioEvents } from "@/services/ScenarioEngine";
eexport function advanceExerciseMinutes(
   patientId: string,
   minutes: number
 ): void {
   const session = getExerciseSession();

   if (session.state !== "running") {
     return;
   }

   const newMinute = session.currentMinute + minutes;

   setExerciseMinute(newMinute);

   runScenarioEvents(patientId, newMinute);

   notifySync();
 }