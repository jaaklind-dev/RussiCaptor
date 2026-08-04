import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import UpcomingEventsCard from "@/components/excon/UpcomingEventsCard";
import ActivePatientsCard from "@/components/excon/ActivePatientsCard";
import EventHistoryCard from "@/components/excon/EventHistoryCard";
import WorkbookImportCard from "@/components/excon/WorkbookImportCard";

import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import { router } from "expo-router";

import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

export default function ExconScreen() {

  const [session, setSession] = useState({

    ...getExerciseSession(),

  });
function refreshSession(): void {

  setSession({

    ...getExerciseSession(),

  });

}
  useEffect(() => {

    return subscribeToSync(() => {

      setSession({

        ...getExerciseSession(),

      });

    });

  }, []);

  return (

    <ScrollView contentContainerStyle={styles.container}>

      <Text style={styles.title}>Exercise Controller</Text>

      <Text style={styles.subtitle}>EXCON · Õppuse juhtimiskeskus</Text>

      <Pressable style={styles.instructorButton} onPress={() => router.push("/excon/dashboard")}>
        <Text style={styles.instructorButtonText}>Open Exercise Dashboard</Text>
      </Pressable>

      <Pressable style={styles.catalogButton} onPress={() => router.push("/excon/catalog")}>
        <Text style={styles.instructorButtonText}>Open Exercise Catalog</Text>
      </Pressable>

      <ExerciseStatusCard session={session} />

      <WorkbookImportCard onImported={refreshSession} />

      <ActivePatientsCard />

      <UpcomingEventsCard session={session} />

      <EventHistoryCard />

      <Pressable
        style={styles.backButton}
        onPress={() => router.replace("/dashboard")}
      >
        <Text style={styles.backButtonText}>Back to Dashboard</Text>
      </Pressable>

    </ScrollView>

  );

}

const styles = StyleSheet.create({

  container: {

    flexGrow: 1,

    padding: 24,

    backgroundColor: "#ffffff",

  },

  title: {

    fontSize: 30,

    fontWeight: "bold",

  },

  subtitle: {

    marginTop: 4,

    fontSize: 16,

    color: "#666",

  },

  backButton: {
    width: "100%",
    borderColor: "#005BBB",
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 12,
  },

  instructorButton: {
    width: "100%", backgroundColor: "#172b4d", borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginTop: 18,
  },

  instructorButtonText: { color: "#fff", fontWeight: "bold", fontSize: 17 },

  catalogButton: {
    width: "100%", backgroundColor: "#005bbb", borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginTop: 10,
  },

  backButtonText: {
    color: "#005BBB",
    fontWeight: "bold",
    fontSize: 18,
  },

});
