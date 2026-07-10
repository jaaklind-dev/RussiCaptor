import { ExerciseSession } from "@/models/ExerciseSession";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
const session: ExerciseSession = {
  exerciseId: getCurrentExercise().id,
  state: "stopped",
  currentMinute: 0,
  speed: 1,
};

export function getExerciseSession(): ExerciseSession {
  return session;
}

export function startExerciseSession(): void {
  session.state = "running";
  session.startedAt = new Date().toISOString();
}

export function pauseExerciseSession(): void {
  session.state = "paused";
}

export function stopExerciseSession(): void {
  session.state = "stopped";
  session.currentMinute = 0;
}

export function setExerciseMinute(
  minute: number
): void {
  session.currentMinute = minute;
}

export function setExerciseSpeed(
  speed: ExerciseSession["speed"]
): void {
  session.speed = speed;
}