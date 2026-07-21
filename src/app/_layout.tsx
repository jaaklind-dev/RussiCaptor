import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribe = () => {};
    let mounted = true;

    loadPersistedState().finally(() => {
      if (!mounted) {
        return;
      }

      unsubscribe = startStatePersistence();
      setIsReady(true);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#F6F8FB" }} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;

}
