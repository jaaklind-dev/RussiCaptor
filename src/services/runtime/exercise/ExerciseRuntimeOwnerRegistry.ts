import type { ExerciseControlCommand, ExerciseControlEventType } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";

export type ExerciseRuntimeOwner = { readonly exerciseId: string; apply(command: ExerciseControlCommand): { snapshot: CanonicalExerciseSnapshot; eventType: ExerciseControlEventType } };
let owner: ExerciseRuntimeOwner | undefined;
export function registerExerciseRuntimeOwner(next: ExerciseRuntimeOwner): () => void { owner = next; return () => { if (owner === next) owner = undefined; }; }
export function getExerciseRuntimeOwner(): ExerciseRuntimeOwner | undefined { return owner; }
export function clearExerciseRuntimeOwner(): void { owner = undefined; }
