import AppHeader from "@/components/AppHeader";
import type { Patient } from "@/models/Patient";
import type { PatientAssignment } from "@/models/PatientAssignment";
import { findPatientById } from "@/repositories/PatientRepository";
import { getMyClosedAssignments } from "@/services/AssignmentRepository";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type HistoryEntry = {
  assignment: PatientAssignment;
  patient: Patient;
};

function loadHistoryEntries(): HistoryEntry[] {
  return getMyClosedAssignments().flatMap((assignment) => {
    const patient = findPatientById(assignment.patientId);
    return patient ? [{ assignment, patient }] : [];
  });
}

export default function HistoryScreen() {
  const [entries, setEntries] = useState(loadHistoryEntries);

  useFocusEffect(
    useCallback(() => {
      setEntries(loadHistoryEntries());
    }, [])
  );

  const completedEntries = entries.filter(
    ({ assignment }) => assignment.endReason === "completed"
  );
  const transferredEntries = entries.filter(
    ({ assignment }) => assignment.endReason === "transferred"
  );

  return (
    <View style={styles.container}>
      <AppHeader />

      <Text style={styles.title}>Ajalugu</Text>
      <Text style={styles.subtitle}>Juhtumikorraldaja tööajalugu</Text>

      {entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Ajalugu on tühi.</Text>
          <Text style={styles.emptyText}>
            Lõpetatud ja teisele juhtumikorraldajale üle antud patsiendid ilmuvad siia.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {completedEntries.length > 0 && (
            <HistorySection title="Lõpetatud" entries={completedEntries} />
          )}
          {transferredEntries.length > 0 && (
            <HistorySection title="Üle antud" entries={transferredEntries} />
          )}
        </ScrollView>
      )}

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryButtonText}>Tagasi</Text>
      </Pressable>
    </View>
  );
}

function HistorySection({ title, entries }: { title: string; entries: HistoryEntry[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {entries.map(({ assignment, patient }) => {
        const isTransferred = assignment.endReason === "transferred";

        return (
          <Pressable
            key={`${patient.id}-${assignment.assignedAt}`}
            style={styles.patientCard}
            onPress={() => router.push(`/patient/${patient.id}`)}
          >
            <View style={styles.patientHeader}>
              <Text style={styles.patientId}>{patient.id}</Text>
              <Text
                style={[
                  styles.badge,
                  isTransferred ? styles.transferredBadge : styles.completedBadge,
                ]}
              >
                {isTransferred ? "Üle antud" : "Lõpetatud"}
              </Text>
            </View>
            <Text style={styles.patientName}>{patient.name}</Text>
            <Text style={styles.patientMeta}>{patient.triage} · {patient.location}</Text>
            {isTransferred && (
              <Text style={styles.transferMeta}>
                Üle antud CM-ile {assignment.transferredToCaseManagerName ?? "–"}
              </Text>
            )}
            <Text style={styles.openLabel}>Ava vaatamisrežiimis</Text>
          </Pressable>
        );
      })}
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
  title: { fontSize: 38, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 20, color: "#555", marginBottom: 24 },
  emptyCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  emptyTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  emptyText: { color: "#555", fontSize: 16, lineHeight: 22 },
  list: { width: "100%", maxWidth: 420, flex: 1 },
  listContent: { gap: 24, paddingBottom: 20 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 22, fontWeight: "bold" },
  patientCard: { backgroundColor: "#f2f4f7", borderRadius: 16, padding: 18 },
  patientHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  patientId: { color: "#005BBB", fontSize: 18, fontWeight: "bold" },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontWeight: "bold" },
  completedBadge: { color: "#166534", backgroundColor: "#dcfce7" },
  transferredBadge: { color: "#1e40af", backgroundColor: "#dbeafe" },
  patientName: { fontSize: 24, fontWeight: "bold", marginTop: 10 },
  patientMeta: { color: "#555", fontSize: 16, marginTop: 6 },
  transferMeta: { color: "#1e40af", fontWeight: "600", marginTop: 8 },
  openLabel: { color: "#005BBB", fontWeight: "bold", marginTop: 12 },
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
  secondaryButtonText: { color: "#005BBB", fontWeight: "bold", fontSize: 18 },
});
