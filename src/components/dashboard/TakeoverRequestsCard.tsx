import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { findPatientById } from "@/repositories/PatientRepository";
import {
  acceptPatientTransfer,
  getMyIncomingTakeoverRequests,
  rejectPatientTransfer,
} from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { subscribeToSync } from "@/services/SyncService";

export default function TakeoverRequestsCard() {
  const [, setRefreshKey] = useState(0);

  useEffect(
    () => subscribeToSync(() => setRefreshKey((value) => value + 1)),
    []
  );

  const requests = getMyIncomingTakeoverRequests();

  if (requests.length === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Ülevõtmistaotlused · {requests.length}</Text>

      {requests.map((request) => {
        const patient = findPatientById(request.patientId);

        return (
          <View key={request.id} style={styles.request}>
            <Text style={styles.patientName}>
              {request.patientId} · {patient?.name ?? "Tundmatu patsient"}
            </Text>
            <Text style={styles.meta}>
              Taotleja: {request.toCaseManagerName}
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.viewButton}
                onPress={() => router.push(`/patient/${request.patientId}`)}
              >
                <Text style={styles.viewButtonText}>Vaata</Text>
              </Pressable>
              <Pressable
                style={styles.rejectButton}
                onPress={() => {
                  Alert.alert(
                    "Keeldu ülevõtmisest?",
                    `${request.toCaseManagerName} ei saa patsiendi omanikuks.`,
                    [
                      { text: "Katkesta", style: "cancel" },
                      {
                        text: "Keeldu",
                        style: "destructive",
                        onPress: () => rejectPatientTransfer(
                          request.patientId,
                          getCurrentCaseManager()
                        ),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.actionButtonText}>Keeldu</Text>
              </Pressable>
              <Pressable
                style={styles.acceptButton}
                onPress={() => {
                  Alert.alert(
                    "Nõustu ülevõtmisega?",
                    `Patsiendi uus Case Manager on ${request.toCaseManagerName}.`,
                    [
                      { text: "Katkesta", style: "cancel" },
                      {
                        text: "Nõustu",
                        onPress: () => acceptPatientTransfer(
                          request.patientId,
                          getCurrentCaseManager()
                        ),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.actionButtonText}>Nõustu</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff7ed",
    borderColor: "#f59e0b",
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  title: {
    color: "#92400e",
    fontSize: 19,
    fontWeight: "bold",
    marginBottom: 12,
  },
  request: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "bold",
  },
  meta: {
    color: "#667085",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  viewButton: {
    borderColor: "#005BBB",
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  viewButtonText: {
    color: "#005BBB",
    fontWeight: "bold",
  },
  rejectButton: {
    backgroundColor: "#b42318",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  acceptButton: {
    backgroundColor: "#166534",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
