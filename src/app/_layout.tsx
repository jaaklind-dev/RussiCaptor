import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { getCloudSyncStatus, startCloudSync } from "@/services/CloudSyncService";
import { failRuntimeCheckpointStartup, startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";
import { startAfterCurrentExerciseDiscovery } from "@/services/exercise/StartupOrchestrationService";
import { getOperatorSession, hasActiveRole, hasOperationalAuthority, hasPlatformAdminAuthority, startOperatorSession, subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { startRuntimeLeaseTimerProbe } from "@/services/runtime/persistence/RuntimeLeaseTimerProbe";

function ProductionRouteGate() {
  const segments = useSegments();
  const operator = useOperatorSession();
  useEffect(() => {
    if (operator.state === "LOADING") return;
    const root = segments[0];
    if (!root || root === "_sitemap") return;
    if (operator.state !== "AUTHENTICATED") { router.replace("/"); return; }
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    const bootstrap = hasActiveRole(operator, "EXERCISE_BOOTSTRAP");
    if (root === "admin" && !hasPlatformAdminAuthority(operator)) router.replace("/");
    else if (root === "excon" && !hasActiveRole(operator, "EXCON", exerciseId) && !bootstrap) router.replace(hasPlatformAdminAuthority(operator) ? "/admin" : "/");
    else if (root !== "excon" && root !== "admin" && !hasActiveRole(operator, "CM", exerciseId)) router.replace(hasActiveRole(operator, "EXCON", exerciseId) || bootstrap ? "/excon" : hasPlatformAdminAuthority(operator) ? "/admin" : "/");
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
    const stopLeaseTimerProbe = startRuntimeLeaseTimerProbe();
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
            const currentOperator = getOperatorSession();
            if (!hasOperationalAuthority(currentOperator)) {
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
      stopLeaseTimerProbe();
    };
  }, []);

  if (!isReady) {
    // Local state can contain a large, durable Runtime checkpoint.  Keep the
    // startup gate fail-closed, but never make that bounded restoration look
    // like a dead React Native root to the operator.
    return <View accessibilityLabel="Rakenduse käivitamine" style={styles.startup}>
      <ActivityIndicator size="large" color="#005BBB" />
      <Text style={styles.startupTitle}>RussiCaptor käivitub</Text>
      <Text style={styles.startupMessage}>Taastan turvaliselt seadme kohalikku seisundit…</Text>
    </View>;
  }

  return <SafeAreaProvider><SafeAreaView edges={["top", "right", "bottom", "left"]} style={{ flex: 1, backgroundColor: "#F6F8FB" }}>
    <ProductionRouteGate /><Stack screenOptions={{ headerShown: false }} />
  </SafeAreaView></SafeAreaProvider>;

}

const styles = StyleSheet.create({
  startup: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: "#F6F8FB",
  },
  startupTitle: { color: "#101828", fontSize: 22, fontWeight: "700" },
  startupMessage: { color: "#475467", fontSize: 16, textAlign: "center" },
});
