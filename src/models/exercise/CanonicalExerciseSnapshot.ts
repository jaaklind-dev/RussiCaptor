export type ExerciseLifecycleState = "READY" | "RUNNING" | "PAUSED" | "COMPLETED";
export type CanonicalExerciseSpeed = 1 | 2 | 4;
export type ExerciseClockVersion = 1 | 2;

export type CanonicalExerciseSnapshot = {
  readonly exerciseId: string;
  readonly lifecycleState: ExerciseLifecycleState;
  readonly simulationTimeSec: number;
  readonly speed: CanonicalExerciseSpeed;
  readonly version: number;
  /** Missing or version 1 identifies a historical pre-WP-22 clock snapshot. */
  readonly clockVersion?: ExerciseClockVersion;
  /** Informational initialization metadata. Excluded from replay hashes. */
  readonly clockInitializedAtSimulationTimeSec?: number;
  readonly lastCommandId?: string;
  /** Metadata only. Excluded from deterministic replay state and hashes. */
  readonly updatedAtWallClock?: string;
};
