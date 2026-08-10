import type { ExerciseControlCommand, ExerciseControlEventType } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSnapshot, ExerciseLifecycleState } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { startClockRunner, stopClockRunner } from "@/services/ClockRunner";
import { notifySync } from "@/services/SyncService";
import { getExerciseRuntimeOwner, registerExerciseRuntimeOwner, type ExerciseRuntimeOwner } from "./ExerciseRuntimeOwnerRegistry";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { prepareActiveClinicalReferenceRuntime } from "./ClinicalReferenceRuntimeService";

const transition: Record<Exclude<ExerciseControlCommand["commandType"], "SET_EXERCISE_SPEED">, { state: ExerciseLifecycleState; event: ExerciseControlEventType }> = {
  START_EXERCISE: { state: "RUNNING", event: "ExerciseStarted" }, PAUSE_EXERCISE: { state: "PAUSED", event: "ExercisePaused" },
  RESUME_EXERCISE: { state: "RUNNING", event: "ExerciseResumed" }, COMPLETE_EXERCISE: { state: "COMPLETED", event: "ExerciseCompleted" },
};

export class AuthoritativeExerciseRuntime implements ExerciseRuntimeOwner {
  readonly definition: ExerciseDefinition;
  readonly exercisePackage: ExercisePackage;
  constructor(readonly exerciseId: string) { this.exercisePackage = getExercisePackage(exerciseId); this.definition = this.exercisePackage.definition; }
  apply(command: ExerciseControlCommand): { snapshot: CanonicalExerciseSnapshot; eventType: ExerciseControlEventType } {
    const previous = getCanonicalExerciseSnapshot();
    const change = command.commandType === "SET_EXERCISE_SPEED" ? undefined : transition[command.commandType];
    const eventType: ExerciseControlEventType = change?.event ?? "ExerciseSpeedChanged";
    if (command.commandType === "START_EXERCISE") prepareActiveClinicalReferenceRuntime(this.exerciseId);
    const next: CanonicalExerciseSnapshot = { ...previous, lifecycleState: change?.state ?? previous.lifecycleState,
      speed: command.commandType === "SET_EXERCISE_SPEED" ? command.payload!.speed! : previous.speed,
      version: previous.version + 1, lastCommandId: command.commandId, updatedAtWallClock: command.issuedAtWallClock };
    replaceCanonicalExerciseSnapshot(next);
    if (next.lifecycleState === "RUNNING") startClockRunner(); else stopClockRunner();
    notifySync("local");
    return { snapshot: getCanonicalExerciseSnapshot(), eventType };
  }
}

let installedExerciseId: string | undefined;
export function initializeAuthoritativeExerciseRuntime(exerciseId: string): void {
  if (installedExerciseId === exerciseId && getExerciseRuntimeOwner()?.exerciseId === exerciseId) return;
  registerExerciseRuntimeOwner(new AuthoritativeExerciseRuntime(exerciseId)); installedExerciseId = exerciseId;
  if (getCanonicalExerciseSnapshot().lifecycleState === "RUNNING") startClockRunner();
}
