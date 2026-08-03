import type { ExerciseControlCommand, ExerciseControlCommandType } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSpeed } from "@/models/exercise/CanonicalExerciseSnapshot";

let sequence = 0;
export function createExerciseControlCommand(input: { exerciseId: string; commandType: ExerciseControlCommandType; expectedVersion: number; speed?: CanonicalExerciseSpeed }): ExerciseControlCommand {
  sequence += 1;
  return { commandId: `EXCON-${Date.now()}-${sequence}`, exerciseId: input.exerciseId, commandType: input.commandType,
    issuedBy: "Exercise Controller", issuedAtWallClock: new Date().toISOString(), expectedVersion: input.expectedVersion,
    payload: input.speed === undefined ? undefined : { speed: input.speed } };
}
