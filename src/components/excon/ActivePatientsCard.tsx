import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  getMyPatients,
  transferPatient,
} from "@/services/AssignmentRepository";
import { finishPatient } from "@/services/PatientCompletionService";
import { subscribeToSync } from "@/services/SyncService";
import { demoTransferTarget } from "@/services/CurrentUserService";

export default function ActivePatientsCard() {
  const [, setRefreshKey] = useState(0);

  useEffect(() => {
    return subscribeToSync(() => setRefreshKey((value) => value + 1));
  }, []);

  const patients = getMyPatients().filter((patient) => patient.status === "Active");

  function confirmFinish(patientId: string, patientName: string): void {
    Alert.alert(
      "Lõpeta patsiendi käsitlus?",
      `${patientId} · ${patientName}\n\nAndmed ja ajalugu säilivad, kuid patsient eemaldatakse aktiivsest tööst.`,
      [
        { text: "Katkesta", style: "cancel" },
        {
          text: "Finish",
          style: "destructive",
          onPress: () => finishPatient(patientId),
        },
      ]
    );
  }

  function confirmTransfer(patientId: string, patientName: string): void {
    Alert.alert(
      "Anna patsient üle?",
      `${patientId} · ${patientName}\n\nUus Case Manager: ${demoTransferTarget.name}`,
      [
        { text: "Katkesta", style: "cancel" },
        {
          text: "Anna üle",
          onPress: () => transferPatient(patientId, demoTransferTarget),
        },
      ]
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Aktiivsed patsiendid</Text>

      {patients.length === 0 ? (
        <Text style={styles.empty}>Aktiivseid patsiente ei ole.</Text>
      ) : (
        patients.map((patient) => (
          <View key={patient.id} style={styles.patientRow}>
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>{patient.id} · {patient.name}</Text>
              <Text style={styles.patientMeta}>{patient.triage} · {patient.location}</Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={styles.transferButton}
                onPress={() => confirmTransfer(patient.id, patient.name)}
              >
                <Text style={styles.actionButtonText}>Anna üle</Text>
              </Pressable>
              <Pressable
                style={styles.finishButton}
                onPress={() => confirmFinish(patient.id, patient.name)}
              >
                <Text style={styles.actionButtonText}>Finish</Text>
              </Pressable>
            </View>
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
  finishButton: {
    backgroundColor: "#b42318",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  transferButton: {
    backgroundColor: "#005BBB",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  actions: {
    gap: 8,
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
