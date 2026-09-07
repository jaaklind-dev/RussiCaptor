let exerciseId: string | undefined;
let cursor = 0;

export function getRuntimePatientCommandCursor(forExerciseId: string): number {
  return exerciseId === forExerciseId ? cursor : 0;
}

export function advanceRuntimePatientCommandCursor(forExerciseId: string, next: number): void {
  if (!Number.isSafeInteger(next) || next < 0) throw new Error("INVALID_RUNTIME_COMMAND_CURSOR");
  if (exerciseId !== forExerciseId) { exerciseId = forExerciseId; cursor = 0; }
  if (next < cursor) throw new Error("RUNTIME_COMMAND_CURSOR_REGRESSION");
  cursor = next;
}

export function restoreRuntimePatientCommandCursor(forExerciseId: string, restored?: number): void {
  if (restored !== undefined && (!Number.isSafeInteger(restored) || restored < 0)) {
    throw new Error("INVALID_RUNTIME_COMMAND_CURSOR");
  }
  exerciseId = forExerciseId;
  cursor = restored ?? 0;
}

export function resetRuntimePatientCommandCursor(): void { exerciseId = undefined; cursor = 0; }
