import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import UpcomingEventsCard from "@/components/excon/UpcomingEventsCard";
import ActivePatientsCard from "@/components/excon/ActivePatientsCard";
import EventHistoryCard from "@/components/excon/EventHistoryCard";
import WorkbookImportCard from "@/components/excon/WorkbookImportCard";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import { router } from "expo-router";

import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { hasActiveRole, signOutOperator } from "@/services/authorization/OperatorSessionService";

export default function ExconScreen() {
  const operator = useOperatorSession();

  const [snapshot, setSnapshot] = useState({

    ...getCanonicalExerciseSnapshot(),

  });
function refreshSession(): void {

  setSnapshot({

    ...getCanonicalExerciseSnapshot(),

  });

}
  useEffect(() => {

    return subscribeToSync(() => {

      setSnapshot({

        ...getCanonicalExerciseSnapshot(),

      });

    });

  }, []);

  useEffect(() => {
    if (operator.state !== "LOADING" && !hasActiveRole(operator, "EXCON", snapshot.exerciseId)) router.replace("/");
  }, [operator, snapshot.exerciseId]);

  return (

    <ScrollView contentContainerStyle={styles.container}>

      <Text style={styles.title}>Õppuse juhtimine</Text>

      <Text style={styles.subtitle}>EXCON · Õppuse juhtimiskeskus</Text>
      {operator.state === "AUTHENTICATED" && <Text style={styles.operator}>Operaator: {operator.profile.displayName}</Text>}

      <Pressable style={styles.instructorButton} onPress={() => router.push("/excon/dashboard")}>
        <Text style={styles.instructorButtonText}>Ava õppuse töölaud</Text>
      </Pressable>

      <Pressable style={styles.catalogButton} onPress={() => router.push("/excon/catalog")}>
        <Text style={styles.instructorButtonText}>Ava õppuste kataloog</Text>
      </Pressable>

      <Pressable style={styles.diagnosticsButton} onPress={() => router.push("/excon/diagnostics" as never)}>
        <Text style={styles.instructorButtonText}>Diagnostika ja taastamine</Text>
      </Pressable>

      <ExerciseStatusCard snapshot={snapshot} />

      <WorkbookImportCard onImported={refreshSession} />

      <ActivePatientsCard />

      <UpcomingEventsCard session={{ exerciseId: snapshot.exerciseId, state: snapshot.lifecycleState === "RUNNING" ? "running" : snapshot.lifecycleState === "PAUSED" ? "paused" : "stopped", currentMinute: snapshot.simulationTimeSec / 60, speed: snapshot.speed }} />

      <EventHistoryCard />

      <Pressable
        style={styles.backButton}
        onPress={() => router.replace("/dashboard")}
      >
        <Text style={styles.backButtonText}>Tagasi töölauale</Text>
      </Pressable>
      <Pressable style={styles.logoutButton} onPress={() => void signOutOperator().then(() => router.replace("/"))}><Text style={styles.logoutButtonText}>Logi välja</Text></Pressable>

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
  operator: { marginTop: 6, color: "#475467" },
  logoutButton: { alignItems: "center", paddingVertical: 14 },
  logoutButtonText: { color: "#B42318", fontWeight: "700" },

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
  diagnosticsButton: { width: "100%", backgroundColor: "#475467", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 10, minHeight: 48, justifyContent: "center" },

  backButtonText: {
    color: "#005BBB",
    fontWeight: "bold",
    fontSize: 18,
  },

});
