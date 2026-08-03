import { router, useFocusEffect } from "expo-router";

import { useCallback, useEffect, useState } from "react";

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

import {
  getDashboardStats,
  getMyIncomingTakeoverRequests,
} from "@/services/AssignmentRepository";
import {
  demoCaseManagers,
  getCurrentCaseManager,
  setCurrentCaseManager,
} from "@/services/CurrentUserService";
import { subscribeToSync } from "@/services/SyncService";
import TakeoverRequestsCard from "@/components/dashboard/TakeoverRequestsCard";
import LocalSaveStatusCard from "@/components/dashboard/LocalSaveStatusCard";
import CloudSyncStatusCard from "@/components/dashboard/CloudSyncStatusCard";
import { getCurrentLocationZone } from "@/services/CurrentLocationService";

export default function DashboardScreen() {

  const [stats, setStats] = useState(getDashboardStats());
  const [selectedCaseManager, setSelectedCaseManager] = useState(
    getCurrentCaseManager
  );
  const [takeoverRequestCount, setTakeoverRequestCount] = useState(
    () => getMyIncomingTakeoverRequests().length
  );

  useEffect(() => {
    return subscribeToSync(() => {
      setStats(getDashboardStats());
      setSelectedCaseManager({ ...getCurrentCaseManager() });
      setTakeoverRequestCount(getMyIncomingTakeoverRequests().length);
    });
  }, []);

  useFocusEffect(

    useCallback(() => {

      setStats(getDashboardStats());
      setTakeoverRequestCount(getMyIncomingTakeoverRequests().length);

    }, [])

  );

  return (

    <ScrollView contentContainerStyle={styles.container}>

      <AppHeader />

      <Text style={styles.title}>CM Dashboard</Text>

      <Text style={styles.subtitle}>
        Case Manager: {selectedCaseManager.name}
      </Text>
      <Text style={styles.locationLine}>
        Asukoht: {getCurrentLocationZone()?.name ?? "Määramata"}
      </Text>

      <View style={styles.demoUserBlock}>
        <Text style={styles.demoUserLabel}>Demo CM</Text>
        <View style={styles.demoUserRow}>
          {demoCaseManagers.map((caseManagerOption) => {
            const isCurrent =
              caseManagerOption.id === selectedCaseManager.id;
            return (
              <Pressable
                key={caseManagerOption.id}
                style={[
                  styles.demoUserButton,
                  isCurrent && styles.demoUserButtonActive,
                ]}
                onPress={() => {
                  setCurrentCaseManager(caseManagerOption);
                  setSelectedCaseManager({ ...caseManagerOption });
                  setStats(getDashboardStats());
                  setTakeoverRequestCount(
                    getMyIncomingTakeoverRequests().length
                  );
                }}
              >
                <Text
                  style={[
                    styles.demoUserButtonText,
                    isCurrent && styles.demoUserButtonTextActive,
                  ]}
                >
                  {caseManagerOption.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <LocalSaveStatusCard />

      <CloudSyncStatusCard />

      <TakeoverRequestsCard />

      <View style={styles.card}>

        <Text style={styles.row}>🟢 Active: {stats.active}</Text>

        <Text style={styles.row}>🔵 Incoming: {stats.incoming}</Text>

        <Text style={styles.row}>⚫ Transferred: {stats.transferred}</Text>

        <Text style={styles.row}>✅ Completed: {stats.completed}</Text>

      </View>

      <Pressable style={styles.button} onPress={() => router.push("/scan")}>

        <Text style={styles.buttonText}>Scan Patient</Text>

      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push("/location")}
      >
        <Text style={styles.secondaryButtonText}>Scan Location</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/patients")}>

        <Text style={styles.secondaryButtonText}>
          My Patients
          {takeoverRequestCount > 0
            ? ` · ${takeoverRequestCount} taotlus(t)`
            : ""}
        </Text>

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

    </ScrollView>

  );

}

const styles = StyleSheet.create({

  container: {

    flexGrow: 1,

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
  locationLine: {
    fontSize: 16,
    color: "#667085",
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

  demoUserBlock: {
    width: "100%",
    maxWidth: 360,
    marginTop: 16,
  },

  demoUserLabel: {
    color: "#667085",
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },

  demoUserRow: {
    flexDirection: "row",
    gap: 8,
  },

  demoUserButton: {
    flex: 1,
    borderColor: "#005BBB",
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },

  demoUserButtonActive: {
    backgroundColor: "#005BBB",
  },

  demoUserButtonText: {
    color: "#005BBB",
    fontWeight: "bold",
  },

  demoUserButtonTextActive: {
    color: "#fff",
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
