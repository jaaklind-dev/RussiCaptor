import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

import { StyleSheet, Text, View } from "react-native";

function formatExerciseTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
export default function ExerciseStatusCard() {

  const session = getExerciseSession();

  return (

    <View style={styles.card}>

      <Text style={styles.cardTitle}>Õppuse seis</Text>

      <Text style={styles.label}>Staatus</Text>

    <Text
      style={[
        styles.status,
        session.state === "running"
          ? styles.running
          : session.state === "paused"
          ? styles.paused
          : styles.stopped,
      ]}
    >
      {session.state.toUpperCase()}
    </Text>

      <Text style={styles.label}>Aeg</Text>

     <Text style={styles.timeValue}>
       {formatExerciseTime(session.currentMinute)}
     </Text>

      <Text style={styles.label}>Kiirus</Text>

      <Text style={styles.value}>×{session.speed}</Text>

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