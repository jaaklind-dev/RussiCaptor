export type ExerciseState =
  | "stopped"
  | "running"
  | "paused";

export type ExerciseSpeed =
  | 1
  | 2
  | 5
  | 10;

export type ExerciseSession = {
  exerciseId: string;

  state: ExerciseState;

  currentMinute: number;

  speed: ExerciseSpeed;

  startedAt?: string;
};