export type ExerciseClockDiagnosticSeverity = "INFO" | "WARNING" | "ERROR";
export type ExerciseClockDiagnosticCode =
  | "CLOCK_CANONICAL"
  | "CLOCK_VERSION_MISSING"
  | "CLOCK_VERSION_LEGACY"
  | "CLOCK_VERSION_UNSUPPORTED"
  | "INITIALIZATION_METADATA_MISSING"
  | "SIMULATION_TIME_NEGATIVE"
  | "LIFECYCLE_INVALID"
  | "SPEED_INVALID"
  | "CLOCK_REGRESSION"
  | "COMPLETED_CLOCK_MUTATED"
  | "OWNER_MISMATCH";

export type ExerciseClockDiagnostic = Readonly<{
  severity: ExerciseClockDiagnosticSeverity;
  code: ExerciseClockDiagnosticCode;
  message: string;
}>;

export type ClockMigrationStatus = "CANONICAL" | "LEGACY_DETECTED" | "MIGRATION_AVAILABLE";

export type ExerciseClockIntegrityResult = Readonly<{
  valid: boolean;
  migrationStatus: ClockMigrationStatus;
  diagnostics: readonly ExerciseClockDiagnostic[];
}>;

