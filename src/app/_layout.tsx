import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { getCloudSyncStatus, startCloudSync } from "@/services/CloudSyncService";
import { failRuntimeCheckpointStartup, startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";
import { startAfterCurrentExerciseDiscovery } from "@/services/exercise/StartupOrchestrationService";

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribeLocal = () => {};
    let unsubscribeCloud = () => {};
    let unsubscribeRuntimeCheckpoint = () => {};
    let mounted = true;

    loadPersistedState().finally(() => {
      if (!mounted) {
        return;
      }

      unsubscribeLocal = startStatePersistence();
      // Remote current-exercise discovery is the startup gate. A stale local
      // RUNNING projection must never acquire writer authority before the
      // authoritative identity is resolved, and a conflict remains fail-closed.
      void startAfterCurrentExerciseDiscovery({
        discover: async () => {
          const unsubscribe = await startCloudSync();
          if (mounted) unsubscribeCloud = unsubscribe;
          else unsubscribe();
          return getCloudSyncStatus();
        },
        startRuntime: startRuntimeCheckpointSync,
      }).then((runtimeUnsubscribe) => {
        if (!runtimeUnsubscribe) return;
        if (mounted) unsubscribeRuntimeCheckpoint = runtimeUnsubscribe;
        else runtimeUnsubscribe();
      }).catch((error) => failRuntimeCheckpointStartup(error));
      setIsReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeLocal();
      unsubscribeCloud();
      unsubscribeRuntimeCheckpoint();
    };
  }, []);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#F6F8FB" }} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;

}
