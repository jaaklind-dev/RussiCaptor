import { createExerciseControlCommand } from "@/features/exercise/ExerciseControlCommandFactory";
import type { ExerciseControlCommandType } from "@/models/exercise/ExerciseControlCommand";
import type { CanonicalExerciseSnapshot, CanonicalExerciseSpeed } from "@/models/exercise/CanonicalExerciseSnapshot";
import { handleExerciseControlCommand } from "@/services/runtime/exercise/ExerciseControlCommandHandler";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

const SPEEDS: readonly CanonicalExerciseSpeed[] = [1, 2, 4];
export function getExerciseControlAvailability(state: CanonicalExerciseSnapshot["lifecycleState"]) {
  return { start: state === "READY", pause: state === "RUNNING", resume: state === "PAUSED",
    complete: state === "RUNNING" || state === "PAUSED", speed: state !== "COMPLETED" };
}

export default function ExerciseControlsCard({ snapshot, onApplied }: { snapshot: CanonicalExerciseSnapshot; onApplied?: () => void }) {
  const enabled = getExerciseControlAvailability(snapshot.lifecycleState);
  const issue = (commandType: ExerciseControlCommandType, speed?: CanonicalExerciseSpeed) => {
    const current = getCanonicalExerciseSnapshot();
    const result = handleExerciseControlCommand(createExerciseControlCommand({ exerciseId: current.exerciseId, commandType, expectedVersion: current.version, speed }));
    if (!result.ok) Alert.alert("Käsk lükati tagasi", result.message);
    else onApplied?.();
  };
  const confirmComplete = () => Alert.alert("Kas lõpetada õppus?", "See toiming on lõplik ega lähtesta õppuse olekut.", [
    { text: "Tühista", style: "cancel" }, { text: "Lõpeta õppus", style: "destructive", onPress: () => issue("COMPLETE_EXERCISE") },
  ]);
  const action = snapshot.lifecycleState === "READY" ? { label: "▶ Alusta", type: "START_EXERCISE" as const, enabled: enabled.start }
    : snapshot.lifecycleState === "PAUSED" ? { label: "▶ Jätka", type: "RESUME_EXERCISE" as const, enabled: enabled.resume }
      : { label: "⏸ Peata", type: "PAUSE_EXERCISE" as const, enabled: enabled.pause };
  return <View style={styles.card}>
    <Text style={styles.title}>Õppuse juhtimine</Text>
    <View style={styles.row}>
      <Pressable disabled={!action.enabled} style={[styles.button, !action.enabled && styles.disabled]} onPress={() => issue(action.type)}><Text style={styles.buttonText}>{action.label}</Text></Pressable>
      <Pressable disabled={!enabled.complete} style={[styles.complete, !enabled.complete && styles.disabled]} onPress={confirmComplete}><Text style={styles.buttonText}>✓ Lõpeta õppus</Text></Pressable>
    </View>
    <Text style={styles.label}>Simulatsiooni kiirus</Text>
    <View style={styles.row}>{SPEEDS.map(speed => <Pressable key={speed} disabled={!enabled.speed}
      style={[styles.speed, snapshot.speed === speed && styles.active, !enabled.speed && styles.disabled]}
      onPress={() => issue("SET_EXERCISE_SPEED", speed)}><Text style={styles.buttonText}>×{speed}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#f2f4f7", borderRadius: 14, padding: 14, marginBottom: 14 }, title: { fontSize: 18, fontWeight: "800", color: "#172b4d", marginBottom: 10 },
  label: { color: "#42526e", fontWeight: "700", marginTop: 12, marginBottom: 7 }, row: { flexDirection: "row", gap: 8 },
  button: { flex: 1, backgroundColor: "#005bbb", padding: 12, borderRadius: 10, alignItems: "center" }, complete: { flex: 1, backgroundColor: "#9b1c1c", padding: 12, borderRadius: 10, alignItems: "center" },
  speed: { flex: 1, backgroundColor: "#5e6c84", padding: 10, borderRadius: 10, alignItems: "center" }, active: { backgroundColor: "#2e7d32" }, disabled: { opacity: 0.35 }, buttonText: { color: "white", fontWeight: "800" },
});
