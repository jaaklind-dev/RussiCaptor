export type ExerciseClock = {
  exerciseId: string;

  currentMinute: number;

  isRunning: boolean;

  speed: 1 | 2 | 5 | 10;
};