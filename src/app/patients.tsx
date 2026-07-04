import { router } from "expo-router";

import { Pressable, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

export default function PatientsScreen() {

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>My Patients</Text>

      <Text style={styles.subtitle}>Case Manager: Jaak</Text>

      <View style={styles.emptyCard}>

        <Text style={styles.emptyTitle}>Patsiente ei ole veel.</Text>

        <Text style={styles.emptyText}>

          Skaneeri patsiendi QR-kood, et ta oma nimekirja lisada.

        </Text>

      </View>

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>

        <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>

      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "white",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 38,

    fontWeight: "bold",

    marginBottom: 12,

  },

  subtitle: {

    fontSize: 20,

    color: "#555",

    marginBottom: 8,

  },

  emptyCard: {

    width: "100%",

    maxWidth: 360,

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 24,

    marginVertical: 28,

  },

  emptyTitle: {

    fontSize: 22,

    fontWeight: "bold",

    marginBottom: 8,

  },

  emptyText: {

    fontSize: 16,

    color: "#555",

  },

  secondaryButton: {

    width: "100%",

    maxWidth: 360,

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