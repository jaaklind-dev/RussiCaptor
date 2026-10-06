import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { useOperatorMode } from "@/hooks/useOperatorMode";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { refreshOperatorSession } from "@/services/authorization/OperatorSessionService";
import {
  resolveAvailableUserModes,
  switchOperatorMode,
  type OperatorMode,
} from "@/services/ui/OperatorModeService";
import { resolveSelectedModeRoute } from "@/services/ui/OperatorRouteService";

const labels: Readonly<Record<OperatorMode, string>> = Object.freeze({
  ADMIN: "Admin",
  CM: "CM",
  EXCON: "EXCON",
});

export default function RoleModeSwitcher() {
  const operator = useOperatorSession();
  const mode = useOperatorMode();
  const [pending, setPending] = useState<OperatorMode>();
  const [error, setError] = useState<string>();
  const available = useMemo(() => resolveAvailableUserModes(operator), [operator]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refreshOperatorSession();
    });
    return () => subscription.remove();
  }, []);

  if (operator.state !== "AUTHENTICATED" || available.length === 0) return null;

  const select = async (next: OperatorMode) => {
    if (pending) return;
    setPending(next); setError(undefined);
    try {
      await switchOperatorMode(operator, next);
      const target = resolveSelectedModeRoute(operator, next, getCanonicalExerciseSnapshot().exerciseId);
      router.replace(target === "/mode" ? { pathname: "/mode", params: { target: next } } : target);
    } catch {
      setError("Režiimi vahetamine ei õnnestunud. Proovi uuesti.");
    } finally { setPending(undefined); }
  };

  return <View style={styles.wrapper} accessibilityRole="tablist" accessibilityLabel="Töörežiim">
    <View style={styles.row}>
      {available.map(item => {
        const selected = item.mode === mode.selectedMode;
        return <Pressable
          key={item.mode}
          accessibilityRole="tab"
          accessibilityLabel={`${labels[item.mode]} režiim`}
          accessibilityState={{ selected, disabled: Boolean(pending) }}
          testID={`mode-${item.mode.toLowerCase()}`}
          disabled={Boolean(pending)}
          onPress={() => void select(item.mode)}
          style={[styles.option, selected && styles.selected, pending && styles.disabled]}
        ><Text style={[styles.label, selected && styles.selectedLabel]}>{pending === item.mode ? "Ootan…" : labels[item.mode]}</Text></Pressable>;
      })}
    </View>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { width: "100%", maxWidth: 480, alignSelf: "center", marginBottom: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", borderRadius: 12, padding: 4, backgroundColor: "#EAECF0", gap: 4 },
  option: { flexGrow: 1, minWidth: 78, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  selected: { backgroundColor: "#005BBB" },
  disabled: { opacity: 0.65 },
  label: { color: "#344054", fontWeight: "800", fontSize: 15 },
  selectedLabel: { color: "#FFFFFF" },
  error: { color: "#B42318", textAlign: "center", marginTop: 7, fontWeight: "700" },
});
