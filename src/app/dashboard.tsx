import { router, useFocusEffect } from "expo-router";

import { useCallback, useState } from "react";

import { Pressable, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

import { getDashboardStats } from "@/services/AssignmentRepository";

export default function DashboardScreen() {

  const [stats, setStats] = useState(getDashboardStats());

  useFocusEffect(

    useCallback(() => {

      setStats(getDashboardStats());

    }, [])

  );

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>CM Dashboard</Text>

      <Text style={styles.subtitle}>Case Manager: Jaak</Text>

      <View style={styles.card}>

        <Text style={styles.row}>🟢 Active: {stats.active}</Text>

        <Text style={styles.row}>🔵 Incoming: {stats.incoming}</Text>

        <Text style={styles.row}>⚫ Transferred: {stats.transferred}</Text>

        <Text style={styles.row}>✅ Completed: {stats.completed}</Text>

      </View>

      <Pressable style={styles.button} onPress={() => router.push("/scan")}>

        <Text style={styles.buttonText}>Scan Patient</Text>

      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/patients")}>

        <Text style={styles.secondaryButtonText}>My Patients</Text>

      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/history")}>

        <Text style={styles.secondaryButtonText}>History</Text>

      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push("/excon")}
      >
        <Text style={styles.secondaryButtonText}>EXCON</Text>
      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "#ffffff",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 38,

    fontWeight: "bold",

    marginBottom: 12,

    textAlign: "center",

  },

  subtitle: {

    fontSize: 20,

    color: "#555",

    marginBottom: 8,

  },

  card: {

    width: "100%",

    maxWidth: 360,

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 20,

    marginVertical: 28,

    gap: 12,

  },

  row: {

    fontSize: 20,

    fontWeight: "600",

  },

  button: {

    width: "100%",

    maxWidth: 360,

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    borderRadius: 12,

    alignItems: "center",

    marginBottom: 12,

  },

  buttonText: {

    color: "#ffffff",

    fontWeight: "bold",

    fontSize: 18,

  },

  secondaryButton: {

    width: "100%",

    maxWidth: 360,

    borderColor: "#005BBB",

    borderWidth: 2,

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginBottom: 12,

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});