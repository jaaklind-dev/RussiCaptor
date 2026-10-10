import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { loadPersistedState, startStatePersistence } from "@/services/StatePersistenceService";
import { getCloudSyncStatus, startCloudSync } from "@/services/CloudSyncService";
import { failRuntimeCheckpointStartup, startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";
import { startAfterCurrentExerciseDiscovery } from "@/services/exercise/StartupOrchestrationService";
import { getOperatorSession, hasActiveRole, hasPlatformAdminAuthority, startOperatorSession, subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { startRuntimeLeaseTimerProbe } from "@/services/runtime/persistence/RuntimeLeaseTimerProbe";
import AuthCallbackCoordinator from "@/components/auth/AuthCallbackCoordinator";
import { useOperatorMode } from "@/hooks/useOperatorMode";
import {
  getOperatorModeSnapshot,
  reconcileOperatorMode,
  resolveAvailableUserModes,
  subscribeOperatorMode,
} from "@/services/ui/OperatorModeService";
import { getSyncVersion, subscribeToSync } from "@/services/SyncService";
import { useExconRouteReadiness } from "@/hooks/useExconRouteReadiness";
import { exconRouteRedirect } from "@/services/ui/ExconRouteReadinessService";
import { getBuilderPickerReturnVersion, readBuilderPickerReturn, shouldRestoreBuilderRoute,
  subscribeBuilderPickerReturn } from "@/services/builder/BuilderPickerReturnService";

function ProductionRouteGate() {
  const segments = useSegments();
  const operator = useOperatorSession();
  const mode = useOperatorMode();
  const exconReadiness = useExconRouteReadiness();
  const syncVersion = useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion);
  const pickerVersion = useSyncExternalStore(subscribeBuilderPickerReturn,
    getBuilderPickerReturnVersion, getBuilderPickerReturnVersion);
  useEffect(() => { reconcileOperatorMode(operator); }, [operator]);
  useEffect(() => {
    if (operator.state === "LOADING") return;
    // Keep only Builder's external-picker return route while authority is
    // temporarily unavailable. Its own screen renders no draft in this state.
    if (operator.state === "UNAVAILABLE" && segments.join("/") === "admin/builder") return;
    const root = segments[0];
    const isDiagnostics = segments.join("/") === "excon/diagnostics";
    if (!root || root === "_sitemap") return;
    if (root === "auth") return;
    if (operator.state !== "AUTHENTICATED") { router.replace("/"); return; }
    if (root === "mode") return;
    if (shouldRestoreBuilderRoute(segments.join("/"), hasPlatformAdminAuthority(operator) &&
      mode.selectedMode === "ADMIN", readBuilderPickerReturn(operator.principal.userId))) {
      router.replace("/admin/builder");
      return;
    }
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    if (isDiagnostics) {
      if (!hasPlatformAdminAuthority(operator)) router.replace("/mode");
      else if (mode.selectedMode !== "ADMIN") router.replace("/mode");
    } else if (root === "admin") {
      if (!hasPlatformAdminAuthority(operator)) router.replace("/mode");
      else if (mode.selectedMode !== "ADMIN") router.replace("/mode");
    }
    else if (root === "excon") {
      const redirect = exconRouteRedirect(exconReadiness);
      if (redirect === "/") router.replace("/");
      else if (redirect === "/excon/active-exercise-conflict" &&
        segments.join("/") !== "excon/active-exercise-conflict") router.replace(redirect);
      else if (redirect === "/mode") router.replace({
        pathname: "/mode",
        params: {
          target: "EXCON",
          ...(exconReadiness.state === "DENIED" && exconReadiness.reason === "EXERCISE_UNAVAILABLE"
            ? { reason: "exercise-unavailable" }
            : {}),
        },
      });
    }
    else if (root !== "excon" && root !== "admin" && (mode.selectedMode !== "CM" || !hasActiveRole(operator, "CM", exerciseId))) router.replace("/mode");
  }, [exconReadiness, mode, operator, segments, syncVersion, pickerVersion]);
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
    let unsubscribeModeState = () => {};
    const stopLeaseTimerProbe = startRuntimeLeaseTimerProbe();
    let applicationStarted = false;
    let applicationMode: "CM" | "EXCON" | undefined;
    let applicationGeneration = 0;
    let mounted = true;

    loadPersistedState().finally(() => {
      if (!mounted) {
        return;
      }

      unsubscribeLocal = startStatePersistence();
      unsubscribeOperator = startOperatorSession();
      const stopAuthenticatedApplication = () => {
        applicationGeneration += 1;
        unsubscribeCloud(); unsubscribeCloud = () => {};
        unsubscribeRuntimeCheckpoint(); unsubscribeRuntimeCheckpoint = () => {};
        applicationStarted = false;
        applicationMode = undefined;
      };
      // Remote current-exercise discovery is the startup gate. A stale local
      // RUNNING projection must never acquire writer authority before the
          // authoritative identity is resolved, and a conflict remains fail-closed.
          const startAuthenticatedApplication = () => {
            if (getOperatorSession().state !== "AUTHENTICATED") {
              if (applicationStarted) stopAuthenticatedApplication();
              return;
            }
            const currentOperator = getOperatorSession();
            const selectedMode = getOperatorModeSnapshot().selectedMode;
            const operationalMode = selectedMode === "CM" || selectedMode === "EXCON" ? selectedMode : undefined;
            const available = resolveAvailableUserModes(currentOperator);
            const operationalAuthority = Boolean(operationalMode && available.some(item => item.mode === operationalMode));
            if (!operationalAuthority) {
              if (applicationStarted) stopAuthenticatedApplication();
              return;
            }
        if (applicationStarted && applicationMode === operationalMode) return;
        if (applicationStarted) stopAuthenticatedApplication();
        applicationStarted = true;
        applicationMode = operationalMode;
        const modeGeneration = ++applicationGeneration;
        void startAfterCurrentExerciseDiscovery({
        discover: async () => {
          const unsubscribe = await startCloudSync();
          if (!mounted || modeGeneration !== applicationGeneration) {
            unsubscribe();
            throw new Error("OPERATOR_MODE_CHANGED");
          }
          unsubscribeCloud = unsubscribe;
          return getCloudSyncStatus();
        },
        startRuntime: startRuntimeCheckpointSync,
        }).then((runtimeUnsubscribe) => {
        if (!runtimeUnsubscribe) return;
        if (mounted && modeGeneration === applicationGeneration) unsubscribeRuntimeCheckpoint = runtimeUnsubscribe;
        else runtimeUnsubscribe();
        }).catch((error) => {
          if (modeGeneration !== applicationGeneration) return;
          applicationStarted = false; applicationMode = undefined; failRuntimeCheckpointStartup(error);
        });
      };
      unsubscribeOperatorState = subscribeOperatorSession(startAuthenticatedApplication);
      unsubscribeModeState = subscribeOperatorMode(startAuthenticatedApplication);
      startAuthenticatedApplication();
      setIsReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeLocal();
      unsubscribeCloud();
      unsubscribeRuntimeCheckpoint();
      unsubscribeOperatorState();
      unsubscribeModeState();
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
    <AuthCallbackCoordinator /><ProductionRouteGate /><Stack screenOptions={{ headerShown: false }} />
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
