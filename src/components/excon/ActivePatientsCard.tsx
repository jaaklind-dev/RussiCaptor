import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { getAllActivePatientAssignments } from "@/services/AssignmentRepository";
import { createPatientCompletionCommandId, submitPatientCompletion } from "@/services/PatientCompletionService";
import { subscribeToSync } from "@/services/SyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { useRuntimePatientCommandSubmissionReadiness } from
  "@/services/runtime/commands/useRuntimePatientCommandSubmissionReadiness";

export default function ActivePatientsCard() {
  const [, setRefreshKey] = useState(0);
  const [pendingPatientId, setPendingPatientId] = useState<string>();
  const inFlightPatientIds = useRef(new Set<string>());
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const commandReadiness = useRuntimePatientCommandSubmissionReadiness(exerciseId);

  useEffect(() => {
    return subscribeToSync(() => setRefreshKey((value) => value + 1));
  }, []);

  const activeAssignments = getAllActivePatientAssignments();

  async function completePatient(patientId: string): Promise<void> {
    if (!commandReadiness.ready || inFlightPatientIds.current.has(patientId)) return;
    inFlightPatientIds.current.add(patientId); setPendingPatientId(patientId);
    const result = await submitPatientCompletion(createPatientCompletionCommandId(exerciseId, patientId), patientId)
      .catch(() => ({ status: "REJECTED" as const, commandId: "", reason: "UNAVAILABLE" }));
    inFlightPatientIds.current.delete(patientId); setPendingPatientId(undefined);
    if (result.status === "REJECTED") Alert.alert("Käsk lükati tagasi", "Patsiendi lõpetamist ei saanud kinnitada.");
  }

  function confirmFinish(patientId: string, patientName: string): void {
    Alert.alert(
      "Lõpeta patsiendi käsitlus?",
      `${patientName}\n\nAndmed ja ajalugu säilivad, kuid patsient eemaldatakse aktiivsest tööst.`,
      [
        { text: "Katkesta", style: "cancel" },
        {
          text: "Lõpeta",
          style: "destructive",
          onPress: () => void completePatient(patientId),
        },
      ]
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Aktiivsed patsiendid</Text>

      {activeAssignments.length === 0 ? (
        <Text style={styles.empty}>Aktiivseid patsiente ei ole.</Text>
      ) : (
        activeAssignments.map(({ assignment, patient }) => (
          <View key={patient.id} style={styles.patientRow}>
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>{patient.name}</Text>
              <Text style={styles.patientMeta}>
                {patient.triage} · {patient.location}
              </Text>
              <Text style={styles.owner}>
                Juhtumikorraldaja: {assignment.caseManagerName}
              </Text>
            </View>
            <Pressable
              disabled={!commandReadiness.ready || pendingPatientId === patient.id}
              style={[styles.finishButton, (!commandReadiness.ready || pendingPatientId === patient.id) && styles.disabled]}
              onPress={() => confirmFinish(patient.id, patient.name)}
            >
              <Text style={styles.actionButtonText}>{pendingPatientId === patient.id ? "Lõpetan…" : "Lõpeta"}</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
    width: "100%",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },
  empty: {
    color: "#666",
  },
  patientRow: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "700",
  },
  patientMeta: {
    color: "#666",
    marginTop: 4,
  },
  owner: {
    color: "#005BBB",
    fontWeight: "600",
    marginTop: 4,
  },
  finishButton: {
    backgroundColor: "#b42318",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  disabled: { opacity: 0.45 },
  actionButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
