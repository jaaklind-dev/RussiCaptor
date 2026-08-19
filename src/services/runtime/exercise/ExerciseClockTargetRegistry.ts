export type ExerciseClockTarget = { readonly targetId: string; advance(fromSimulationTimeSec: number, toSimulationTimeSec: number): void };
const targets = new Map<string, ExerciseClockTarget>();
export function registerExerciseClockTarget(target: ExerciseClockTarget): () => void { targets.set(target.targetId, target); return () => { if (targets.get(target.targetId) === target) targets.delete(target.targetId); }; }
export function advanceExerciseClockTargets(from: number, to: number): void { [...targets.values()].sort((a, b) => a.targetId.localeCompare(b.targetId)).forEach(target => target.advance(from, to)); }
export function getRegisteredExerciseClockTargetIds(): readonly string[] { return Object.freeze([...targets.keys()].sort()); }
export function clearExerciseClockTargets(): void { targets.clear(); }
