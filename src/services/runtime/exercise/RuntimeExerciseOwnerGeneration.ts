import { AuthoritativeExerciseRuntime } from "./AuthoritativeExerciseRuntime";
import {
  getExerciseRuntimeOwner,
  registerExerciseRuntimeOwner,
  type ExerciseRuntimeOwner,
} from "./ExerciseRuntimeOwnerRegistry";

type RuntimeOwnerFactory = (exerciseId: string) => ExerciseRuntimeOwner;

/**
 * Owns the exercise-control Runtime registration for one checkpoint-sync
 * generation. Registry cleanup is identity-safe, so a stale generation cannot
 * remove or replace an owner installed by a newer generation.
 */
export class RuntimeExerciseOwnerGeneration {
  private owner: ExerciseRuntimeOwner | undefined;
  private unregister: (() => void) | undefined;

  constructor(
    private readonly exerciseId: string,
    private readonly isCurrent: () => boolean,
    private readonly createOwner: RuntimeOwnerFactory = id => new AuthoritativeExerciseRuntime(id),
  ) {}

  establish(): boolean {
    if (!this.isCurrent()) return false;
    if (this.owner && getExerciseRuntimeOwner() === this.owner) return true;
    this.unregister?.();
    const owner = this.createOwner(this.exerciseId);
    if (!this.isCurrent()) return false;
    this.owner = owner;
    this.unregister = registerExerciseRuntimeOwner(owner);
    return true;
  }

  isReady(): boolean {
    return this.isCurrent()
      && this.owner !== undefined
      && getExerciseRuntimeOwner() === this.owner;
  }

  release(): void {
    this.unregister?.();
    this.unregister = undefined;
    this.owner = undefined;
  }
}
