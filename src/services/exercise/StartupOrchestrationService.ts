import type { CloudSyncStatus } from "@/services/CloudSyncService";

export type StartupOrchestration = Readonly<{
  discover: () => Promise<CloudSyncStatus>;
  startRuntime: () => Promise<() => void>;
}>;

export function currentExerciseDiscoveryAllowsRuntime(status: CloudSyncStatus): boolean {
  return status.state === "synced" || status.state === "disabled";
}

export async function startAfterCurrentExerciseDiscovery(
  orchestration: StartupOrchestration,
): Promise<(() => void) | undefined> {
  const status = await orchestration.discover();
  if (!currentExerciseDiscoveryAllowsRuntime(status)) {
    const reason = status.message ?? `CURRENT_EXERCISE_DISCOVERY_${status.state.toUpperCase()}`;
    throw new Error(reason);
  }
  return orchestration.startRuntime();
}
