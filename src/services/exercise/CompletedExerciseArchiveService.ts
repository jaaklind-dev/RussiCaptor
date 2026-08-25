import type { AnalyticsReport } from "@/models/analytics/Analytics";
import type { ProtocolAssessmentReport } from "@/models/assessment/ProtocolAssessment";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { DebriefReport } from "@/services/debrief/DebriefModel";
import { deepFreeze } from "@/utils/immutable";

export type CompletedExerciseArchive = Readonly<{
  exerciseId: string;
  snapshot: CanonicalExerciseSnapshot;
  debrief: DebriefReport;
  analytics: AnalyticsReport;
  protocolAssessment?: ProtocolAssessmentReport;
}>;

const archives = new Map<string, CompletedExerciseArchive>();
const durableArchiveIds = new Set<string>();
export function storeCompletedExerciseArchive(value: CompletedExerciseArchive): CompletedExerciseArchive {
  const existing = archives.get(value.exerciseId); if (existing) return existing;
  const stored = deepFreeze(structuredClone(value)) as CompletedExerciseArchive; archives.set(value.exerciseId, stored); return stored;
}
export function getCompletedExerciseArchive(exerciseId: string): CompletedExerciseArchive | undefined { const value = archives.get(exerciseId); return value ? deepFreeze(structuredClone(value)) as CompletedExerciseArchive : undefined; }
export function getCompletedExerciseArchives(): readonly CompletedExerciseArchive[] { return Object.freeze([...archives.values()].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId)).map(item => deepFreeze(structuredClone(item)) as CompletedExerciseArchive)); }
export function getPendingCompletedExerciseArchives(): readonly CompletedExerciseArchive[] {
  return Object.freeze(getCompletedExerciseArchives().filter(item => !durableArchiveIds.has(item.exerciseId)));
}
export function markCompletedExerciseArchiveDurable(exerciseId: string): void {
  durableArchiveIds.add(exerciseId);
}
export function restoreCompletedExerciseArchives(values: readonly CompletedExerciseArchive[]): void {
  const restoredIds = new Set(values.map(value => value.exerciseId));
  archives.clear();
  for (const exerciseId of durableArchiveIds) {
    if (!restoredIds.has(exerciseId)) durableArchiveIds.delete(exerciseId);
  }
  values.forEach(value => archives.set(value.exerciseId, deepFreeze(structuredClone(value)) as CompletedExerciseArchive));
}
export function clearCompletedExerciseArchives(): void { archives.clear(); durableArchiveIds.clear(); }
