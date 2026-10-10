import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import RoleModeSwitcher from "@/components/RoleModeSwitcher";
import { useOperatorMode } from "@/hooks/useOperatorMode";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { exercisePackageIdLabel } from "@/localization/et";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { refreshOperatorSession } from "@/services/authorization/OperatorSessionService";
import {
  continueAssignedActiveExercise,
  assignedExerciseSelectionMessage,
  refreshActiveExerciseConflict,
  type ActiveExerciseConflictDetail,
} from "@/services/exercise/ActiveExerciseConflictResolutionService";
import { getSyncVersion, subscribeToSync } from "@/services/SyncService";
import { resolveAvailableUserModes, type OperatorMode } from "@/services/ui/OperatorModeService";
import { resolveSelectedModeRoute } from "@/services/ui/OperatorRouteService";

const modeLabels: Readonly<Record<OperatorMode, string>> = Object.freeze({ ADMIN: "Admin", CM: "CM", EXCON: "EXCON" });

export default function ModeSelectionScreen() {
  const { target, reason } = useLocalSearchParams<{ target?: string; reason?: string }>();
  const operator = useOperatorSession();
  const mode = useOperatorMode();
  const syncVersion = useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion);
  const [details, setDetails] = useState<readonly ActiveExerciseConflictDetail[]>([]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const available = useMemo(() => resolveAvailableUserModes(operator), [operator]);
  const selected = available.find(item => item.mode === mode.selectedMode);
  const shouldLoadConflictDetails = Boolean(selected && selected.mode !== "ADMIN" && selected.exerciseIds.length > 1);
  const selectedExerciseIdsKey = selected?.exerciseIds.join("|") ?? "";
  const current = getCanonicalExerciseSnapshot();

  useEffect(() => {
    if (operator.state !== "AUTHENTICATED") return;
    const route = resolveSelectedModeRoute(operator, mode.selectedMode, current.exerciseId);
    if (route !== "/mode") router.replace(route);
  }, [current.exerciseId, mode.selectedMode, operator, syncVersion]);

  useEffect(() => {
    if (!shouldLoadConflictDetails) return;
    let active = true;
    void refreshActiveExerciseConflict().then(value => { if (active) setDetails(value); }).catch(() => {});
    return () => { active = false; };
  }, [selectedExerciseIdsKey, shouldLoadConflictDetails]);

  const chooseExercise = async (exerciseId: string) => {
    if (!selected || selected.mode === "ADMIN" || pending) return;
    setPending(exerciseId); setError(undefined);
    try {
      const result = await continueAssignedActiveExercise(exerciseId, selected.mode);
      if (!result.ok) throw new Error(result.code ?? "EXERCISE_SELECTION_FAILED");
      router.replace(selected.mode === "CM" ? "/dashboard" : "/excon");
    } catch (cause) {
      setError(assignedExerciseSelectionMessage(cause instanceof Error ? cause.message : undefined));
    } finally { setPending(undefined); }
  };

  const requested = target && ["ADMIN", "CM", "EXCON"].includes(target) ? target as OperatorMode : undefined;
  return <ScrollView contentContainerStyle={styles.page} testID="mode-selection-screen">
    <Text style={styles.kicker}>RussiCaptor</Text>
    <Text style={styles.title}>Vali töörežiim</Text>
    <Text style={styles.subtitle}>Näed ainult neid režiime ja õppusi, mille jaoks sul on kehtiv õigus.</Text>
    <RoleModeSwitcher />
    {requested && mode.selectedMode !== requested && <Text style={styles.note}>Vali jätkamiseks {modeLabels[requested]}.</Text>}
    {reason === "exercise-unavailable" && <Text accessibilityRole="alert" style={styles.error}>
      Määratud õppust ei õnnestunud avada. Vali õppus uuesti või värskenda õigusi.
    </Text>}
    {selected && selected.mode !== "ADMIN" && <View style={styles.panel}>
      <Text style={styles.panelTitle}>{modeLabels[selected.mode]} õppus</Text>
      {selected.exerciseIds.length === 1
        ? <Text style={styles.note}>Õppuse autoriteeti kontrollitakse…</Text>
        : <Text style={styles.note}>Sul on selles režiimis mitu õppust. Vali jätkamiseks üks.</Text>}
      {selected.exerciseIds.map((exerciseId, index) => {
        const detail = details.find(item => item.exerciseId === exerciseId);
        const isCurrent = current.exerciseId === exerciseId;
        const label = detail?.packageId ? exercisePackageIdLabel(detail.packageId)
          : isCurrent ? "Praegune õppus" : `Määratud õppus ${index + 1}`;
        return <Pressable key={exerciseId} testID={`mode-exercise-${index + 1}`}
          accessibilityRole="button" disabled={Boolean(pending)}
          onPress={() => void chooseExercise(exerciseId)} style={[styles.exercise, pending && styles.disabled]}>
          <Text style={styles.exerciseTitle}>{label}</Text>
          <Text style={styles.exerciseMeta}>{isCurrent ? "Praegune õppus" : "Ava õppus"}</Text>
        </Pressable>;
      })}
    </View>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" style={styles.refresh} onPress={() => void refreshOperatorSession()}>
      <Text style={styles.refreshText}>Värskenda õigusi</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 24, backgroundColor: "#F6F8FB", gap: 12 },
  kicker: { color: "#005BBB", fontWeight: "800", marginTop: 12 },
  title: { color: "#101828", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#475467", fontSize: 16, lineHeight: 22, marginBottom: 8 },
  panel: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 14, padding: 16, gap: 10 },
  panelTitle: { color: "#101828", fontSize: 19, fontWeight: "800" },
  note: { color: "#475467", lineHeight: 20 },
  exercise: { minHeight: 56, borderWidth: 1, borderColor: "#98A2B3", borderRadius: 10, padding: 12, justifyContent: "center" },
  exerciseTitle: { color: "#101828", fontWeight: "800" },
  exerciseMeta: { color: "#667085", marginTop: 3 },
  disabled: { opacity: 0.6 },
  error: { color: "#B42318", fontWeight: "700", textAlign: "center" },
  refresh: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  refreshText: { color: "#005BBB", fontWeight: "800" },
});
