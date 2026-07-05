import { router, useLocalSearchParams } from "expo-router";

import { Pressable, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

export default function PatientOverviewScreen() {

  const { id } = useLocalSearchParams<{ id: string }>();

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>{id}</Text>

      <Text style={styles.subtitle}>Jüri Kask · P2 · EMO triaaž</Text>

      <View style={styles.card}>

        <Text style={styles.sectionTitle}>Patient Overview</Text>

        <Text style={styles.row}>Current CM: Jaak</Text>

        <Text style={styles.row}>Status: Active</Text>

        <Text style={styles.row}>Last seen: 09:22</Text>

      </View>

      <Pressable style={styles.button}>

        <Text style={styles.buttonText}>MIST</Text>

      </Pressable>

      <Pressable style={styles.button}>

        <Text style={styles.buttonText}>Questions</Text>

      </Pressable>

      <Pressable style={styles.button}>

        <Text style={styles.buttonText}>Timeline</Text>

      </Pressable>

      <Pressable style={styles.button}>

        <Text style={styles.buttonText}>Labs</Text>

      </Pressable>

      <Pressable style={styles.button}>

        <Text style={styles.buttonText}>Imaging</Text>

      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>

        <Text style={styles.secondaryButtonText}>Back</Text>

      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "white",

    padding: 24,

    paddingTop: 120,

  },

  title: {

    fontSize: 38,

    fontWeight: "bold",

    marginBottom: 8,

  },

  subtitle: {

    fontSize: 18,

    color: "#555",

    marginBottom: 20,

  },

  card: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

    marginBottom: 20,

    gap: 8,

  },

  sectionTitle: {

    fontSize: 20,

    fontWeight: "bold",

    marginBottom: 6,

  },

  row: {

    fontSize: 16,

    color: "#444",

  },

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    paddingHorizontal: 20,

    borderRadius: 12,

    marginBottom: 12,

  },

  buttonText: {

    color: "white",

    fontWeight: "bold",

    fontSize: 18,

  },

  secondaryButton: {

    borderColor: "#005BBB",

    borderWidth: 2,

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginTop: 12,

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});