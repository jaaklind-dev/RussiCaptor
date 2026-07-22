import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { startCloudSync } from "@/services/CloudSyncService";

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribeLocal = () => {};
    let unsubscribeCloud = () => {};
    let mounted = true;

    loadPersistedState().finally(() => {
      if (!mounted) {
        return;
      }

      unsubscribeLocal = startStatePersistence();
      void startCloudSync().then((unsubscribe) => {
        if (mounted) {
          unsubscribeCloud = unsubscribe;
        } else {
          unsubscribe();
        }
      });
      setIsReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeLocal();
      unsubscribeCloud();
    };
  }, []);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#F6F8FB" }} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;

}
