export const EXERCISE_PROFILES = ["ALS", "MASCAL", "EMERGENCY_DEPARTMENT", "BOTULISM", "TRAUMA", "CUSTOM"] as const;
export type ExerciseProfile = typeof EXERCISE_PROFILES[number];
