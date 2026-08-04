import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { ExerciseClockDiagnostic, ExerciseClockIntegrityResult } from "./ExerciseClockDiagnostics";

const lifecycles = ["READY", "RUNNING", "PAUSED", "COMPLETED"];
const speeds = [1, 2, 4];
const diagnostic = (severity: ExerciseClockDiagnostic["severity"], code: ExerciseClockDiagnostic["code"], message: string): ExerciseClockDiagnostic => Object.freeze({ severity, code, message });

/** Pure integrity check. It identifies historical state but never rewrites it. */
export function validateExerciseClock(snapshot: CanonicalExerciseSnapshot, options: Readonly<{ previous?: CanonicalExerciseSnapshot; ownerExerciseId?: string }> = {}): ExerciseClockIntegrityResult {
  const diagnostics: ExerciseClockDiagnostic[] = [];
  if (snapshot.clockVersion === undefined) diagnostics.push(diagnostic("WARNING", "CLOCK_VERSION_MISSING", "Exercise clock version is missing"));
  else if (snapshot.clockVersion === 1) diagnostics.push(diagnostic("WARNING", "CLOCK_VERSION_LEGACY", "Exercise uses the legacy clock schema"));
  else if (snapshot.clockVersion !== 2) diagnostics.push(diagnostic("ERROR", "CLOCK_VERSION_UNSUPPORTED", "Exercise clock version is unsupported"));
  if (snapshot.clockVersion === 2 && snapshot.clockInitializedAtSimulationTimeSec === undefined) diagnostics.push(diagnostic("WARNING", "INITIALIZATION_METADATA_MISSING", "Canonical clock initialization metadata is missing"));
  if (!Number.isFinite(snapshot.simulationTimeSec) || snapshot.simulationTimeSec < 0) diagnostics.push(diagnostic("ERROR", "SIMULATION_TIME_NEGATIVE", "Simulation time must be a non-negative finite number"));
  if (!lifecycles.includes(snapshot.lifecycleState)) diagnostics.push(diagnostic("ERROR", "LIFECYCLE_INVALID", "Exercise lifecycle state is invalid"));
  if (!speeds.includes(snapshot.speed)) diagnostics.push(diagnostic("ERROR", "SPEED_INVALID", "Exercise speed is invalid"));
  if (options.ownerExerciseId !== undefined && options.ownerExerciseId !== snapshot.exerciseId) diagnostics.push(diagnostic("ERROR", "OWNER_MISMATCH", "Authoritative clock owner does not match the exercise"));
  const previous = options.previous;
  if (previous?.exerciseId === snapshot.exerciseId && snapshot.simulationTimeSec < previous.simulationTimeSec) diagnostics.push(diagnostic("ERROR", "CLOCK_REGRESSION", "Simulation time regressed"));
  if (previous?.exerciseId === snapshot.exerciseId && previous.lifecycleState === "COMPLETED" && (snapshot.lifecycleState !== "COMPLETED" || snapshot.simulationTimeSec !== previous.simulationTimeSec || snapshot.speed !== previous.speed)) diagnostics.push(diagnostic("ERROR", "COMPLETED_CLOCK_MUTATED", "Completed exercise clock is immutable"));
  const hasLegacy = snapshot.clockVersion !== 2 || snapshot.clockInitializedAtSimulationTimeSec === undefined;
  if (diagnostics.length === 0) diagnostics.push(diagnostic("INFO", "CLOCK_CANONICAL", "Exercise clock is canonical"));
  const hasError = diagnostics.some(item => item.severity === "ERROR");
  return Object.freeze({ valid: !hasError, migrationStatus: hasLegacy ? (hasError ? "LEGACY_DETECTED" : "MIGRATION_AVAILABLE") : "CANONICAL", diagnostics: Object.freeze(diagnostics) });
}
