import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

import { StyleSheet, Text, View } from "react-native";

export default function ExerciseStatusCard() {

  const session = getExerciseSession();

  return (

    <View style={styles.card}>

      <Text style={styles.cardTitle}>Õppuse seis</Text>

      <Text style={styles.label}>Staatus</Text>

      <Text style={styles.value}>{session.state}</Text>

      <Text style={styles.label}>Aeg</Text>

      <Text style={styles.value}>{session.currentMinute} min</Text>

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

});