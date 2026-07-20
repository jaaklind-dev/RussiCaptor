import AppHeader from "@/components/AppHeader";
import { getAllPatients } from "@/repositories/PatientRepository";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function HistoryScreen() {
  const [completedPatients, setCompletedPatients] = useState(
    getAllPatients().filter((patient) => patient.status === "Completed")
  );

  useFocusEffect(
    useCallback(() => {
      setCompletedPatients(
        getAllPatients().filter((patient) => patient.status === "Completed")
      );
    }, [])
  );

  return (
    <View style={styles.container}>
      <AppHeader />

      <Text style={styles.title}>History</Text>
      <Text style={styles.subtitle}>Lõpetatud patsiendid</Text>

      {completedPatients.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Ajalugu on tühi.</Text>
          <Text style={styles.emptyText}>
            EXCON-is lõpetatud patsiendid ilmuvad siia koos säilinud haigusloo ja tulemustega.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {completedPatients.map((patient) => (
            <Pressable
              key={patient.id}
              style={styles.patientCard}
              onPress={() => router.push(`/patient/${patient.id}`)}
            >
              <View style={styles.patientHeader}>
                <Text style={styles.patientId}>{patient.id}</Text>
                <Text style={styles.completedBadge}>Completed</Text>
              </View>
              <Text style={styles.patientName}>{patient.name}</Text>
              <Text style={styles.patientMeta}>{patient.triage} · {patient.location}</Text>
              <Text style={styles.openLabel}>Ava säilinud haiguslugu</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    padding: 24,
    paddingTop: 108,
  },
  title: {
    fontSize: 38,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 20,
    color: "#555",
    marginBottom: 24,
  },
  emptyCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 8,
  },
  emptyText: {
    color: "#555",
    fontSize: 16,
    lineHeight: 22,
  },
  list: {
    width: "100%",
    maxWidth: 420,
    flex: 1,
  },
  listContent: {
    gap: 12,
    paddingBottom: 20,
  },
  patientCard: {
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
  },
  patientHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  patientId: {
    color: "#005BBB",
    fontSize: 18,
    fontWeight: "bold",
  },
  completedBadge: {
    color: "#166534",
    backgroundColor: "#dcfce7",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: "bold",
  },
  patientName: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 10,
  },
  patientMeta: {
    color: "#555",
    fontSize: 16,
    marginTop: 6,
  },
  openLabel: {
    color: "#005BBB",
    fontWeight: "bold",
    marginTop: 12,
  },
  secondaryButton: {
    width: "100%",
    maxWidth: 420,
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
