import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { exerciseLifecycleLabel } from "@/localization/et";
import { StyleSheet, Text, View } from "react-native";

export function getExerciseStatusPresentation(snapshot: CanonicalExerciseSnapshot) {
  return Object.freeze({
    exerciseId: snapshot.exerciseId,
    lifecycleState: snapshot.lifecycleState,
    lifecycleLabel: exerciseLifecycleLabel(snapshot.lifecycleState),
    runtimeExecutionState: snapshot.lifecycleState === "RUNNING" ? "RUNNING" : "STOPPED",
  });
}

function formatExerciseTime(totalSeconds: number): string {
  const totalMinutes = totalSeconds / 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function ExerciseStatusCard({
  snapshot,
}: { snapshot: CanonicalExerciseSnapshot }) {
  const presentation = getExerciseStatusPresentation(snapshot);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Õppuse seis</Text>

      <Text style={styles.label}>Staatus</Text>

      <Text
        style={[
          styles.status,
          snapshot.lifecycleState === "RUNNING"
            ? styles.running
            : snapshot.lifecycleState === "PAUSED"
              ? styles.paused
              : styles.stopped,
        ]}
      >
        {presentation.lifecycleLabel}
      </Text>

      <Text style={styles.label}>Aeg</Text>

      <Text style={styles.timeValue}>
        {formatExerciseTime(snapshot.simulationTimeSec)}
      </Text>

      <Text style={styles.timeHint}>
        õppuse aeg (hh:mm)
      </Text>

      <Text style={styles.label}>Kiirus</Text>
      <Text style={styles.value}>×{snapshot.speed}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 24,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
    width: "100%",
  },
timeHint: {
  marginTop: 2,
  color: "#666",
  fontSize: 13,
},
  cardTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 16,
  },

  label: {
    marginTop: 10,
    color: "#666",
  },

  value: {
    fontSize: 18,
    fontWeight: "bold",
  },

  timeValue: {
    fontSize: 32,
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
  },

  status: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },

  running: {
    color: "#2E7D32",
  },

  paused: {
    color: "#F9A825",
  },

  stopped: {
    color: "#C62828",
  },
});
