import { useEffect, useState, useSyncExternalStore } from "react";

import { useOperatorMode } from "@/hooks/useOperatorMode";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import {
  getCloudSyncStatus,
  getCurrentExerciseDiscoveryReadiness,
  subscribeToCloudSyncStatus,
  type CloudSyncStatus,
} from "@/services/CloudSyncService";
import { getSyncVersion, subscribeToSync } from "@/services/SyncService";
import { resolveExconRouteReadiness } from "@/services/ui/ExconRouteReadinessService";

export function useExconRouteReadiness() {
  const operator = useOperatorSession();
  const mode = useOperatorMode();
  useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() => getCloudSyncStatus());

  useEffect(() => subscribeToCloudSyncStatus(setCloudStatus), []);

  return resolveExconRouteReadiness({
    operator,
    mode,
    currentExerciseId: getCanonicalExerciseSnapshot().exerciseId,
    discovery: getCurrentExerciseDiscoveryReadiness(cloudStatus),
  });
}
