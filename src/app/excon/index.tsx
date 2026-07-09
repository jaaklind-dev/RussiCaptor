import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { StyleSheet, Text, View } from "react-native";
import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";
export default function ExconScreen() {
  const session = getExerciseSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EXCON</Text>
      <Text style={styles.subtitle}>Õppuse juhtimiskeskus</Text>

      <ExerciseStatusCard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#ffffff",
  },

  title: {
    fontSize: 30,
    fontWeight: "bold",
  },

  subtitle: {
    marginTop: 4,
    fontSize: 16,
    color: "#666",
  },

  card: {
    marginTop: 24,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
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
});