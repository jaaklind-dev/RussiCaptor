import { getSyncVersion, subscribeToSync } from "@/services/SyncService";
import { getCanonicalExerciseTimeline } from "@/services/runtime/exercise/ExerciseTimelineAggregator";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

let cachedVersion = -1; let cachedTimeline = getCanonicalExerciseTimeline();
export function getExerciseTimelineSnapshot() { const version = getSyncVersion(); if (version !== cachedVersion) { cachedTimeline = getCanonicalExerciseTimeline(); cachedVersion = version; } return cachedTimeline; }
export function getExerciseTimelineVersion(): number { return getSyncVersion(); }
export function subscribeToExerciseTimeline(listener: () => void): () => void { return subscribeToSync(listener); }
export function getExerciseTimelineReplayHash(): string { return sha256Text(stableJson(getExerciseTimelineSnapshot())); }
