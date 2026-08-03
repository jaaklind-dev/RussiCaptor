import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { StyleSheet, Text, View } from "react-native";

export default function ExerciseReadOnlyStatusCard({ snapshot }: { snapshot: CanonicalExerciseSnapshot }) {
  return <View style={styles.card}>
    <Text style={styles.label}>Exercise</Text>
    <Text style={styles.state}>{snapshot.lifecycleState} · ×{snapshot.speed}</Text>
    <Text style={styles.time}>T+{snapshot.simulationTimeSec}s</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { width: "100%", maxWidth: 360, borderRadius: 12, backgroundColor: "#eef4ff", padding: 14, marginTop: 16 }, label: { color: "#42526e", fontWeight: "700" }, state: { color: "#172b4d", fontWeight: "800", marginTop: 3 }, time: { color: "#005bbb", fontWeight: "800", marginTop: 3, fontVariant: ["tabular-nums"] } });
