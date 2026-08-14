import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { startCloudSync } from "@/services/CloudSyncService";
import { failRuntimeCheckpointStartup, startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";

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
      void startRuntimeCheckpointSync().then((runtimeUnsubscribe) => {
        if (!mounted) { runtimeUnsubscribe(); return; }
        unsubscribeRuntimeCheckpoint = runtimeUnsubscribe;
        return startCloudSync().then((unsubscribe) => {
          if (mounted) unsubscribeCloud = unsubscribe; else unsubscribe();
        });
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
