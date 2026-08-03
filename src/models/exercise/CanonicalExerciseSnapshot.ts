export type ExerciseLifecycleState = "READY" | "RUNNING" | "PAUSED" | "COMPLETED";
export type CanonicalExerciseSpeed = 1 | 2 | 4;

export type CanonicalExerciseSnapshot = {
  readonly exerciseId: string;
  readonly lifecycleState: ExerciseLifecycleState;
  readonly simulationTimeSec: number;
  readonly speed: CanonicalExerciseSpeed;
  readonly version: number;
  readonly lastCommandId?: string;
  /** Metadata only. Excluded from deterministic replay state and hashes. */
  readonly updatedAtWallClock?: string;
};
