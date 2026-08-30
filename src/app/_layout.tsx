import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { getCloudSyncStatus, startCloudSync } from "@/services/CloudSyncService";
import { failRuntimeCheckpointStartup, startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";
import { startAfterCurrentExerciseDiscovery } from "@/services/exercise/StartupOrchestrationService";
import { getOperatorSession, hasActiveRole, startOperatorSession, subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

function ProductionRouteGate() {
  const segments = useSegments();
  const operator = useOperatorSession();
  useEffect(() => {
    if (operator.state === "LOADING") return;
    const root = segments[0];
    if (!root || root === "_sitemap") return;
    if (operator.state !== "AUTHENTICATED") { router.replace("/"); return; }
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    if (root === "excon" && !hasActiveRole(operator, "EXCON", exerciseId)) router.replace("/");
    else if (root !== "excon" && !hasActiveRole(operator, "CM", exerciseId)) router.replace(hasActiveRole(operator, "EXCON", exerciseId) ? "/excon" : "/");
  }, [operator, segments]);
  return null;
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let unsubscribeLocal = () => {};
    let unsubscribeCloud = () => {};
    let unsubscribeRuntimeCheckpoint = () => {};
    let unsubscribeOperator = () => {};
    let unsubscribeOperatorState = () => {};
    let applicationStarted = false;
    let mounted = true;

    loadPersistedState().finally(() => {
      if (!mounted) {
        return;
      }

      unsubscribeLocal = startStatePersistence();
      unsubscribeOperator = startOperatorSession();
      // Remote current-exercise discovery is the startup gate. A stale local
      // RUNNING projection must never acquire writer authority before the
      // authoritative identity is resolved, and a conflict remains fail-closed.
      const startAuthenticatedApplication = () => {
        if (getOperatorSession().state !== "AUTHENTICATED") {
          if (applicationStarted) {
            unsubscribeCloud(); unsubscribeCloud = () => {};
            unsubscribeRuntimeCheckpoint(); unsubscribeRuntimeCheckpoint = () => {};
            applicationStarted = false;
          }
          return;
        }
        if (applicationStarted) return;
        applicationStarted = true;
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
        }).catch((error) => { applicationStarted = false; failRuntimeCheckpointStartup(error); });
      };
      unsubscribeOperatorState = subscribeOperatorSession(startAuthenticatedApplication);
      startAuthenticatedApplication();
      setIsReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeLocal();
      unsubscribeCloud();
      unsubscribeRuntimeCheckpoint();
      unsubscribeOperatorState();
      unsubscribeOperator();
    };
  }, []);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#F6F8FB" }} />;
  }

  return <SafeAreaProvider><SafeAreaView edges={["top", "right", "bottom", "left"]} style={{ flex: 1, backgroundColor: "#F6F8FB" }}>
    <ProductionRouteGate /><Stack screenOptions={{ headerShown: false }} />
  </SafeAreaView></SafeAreaProvider>;

}
