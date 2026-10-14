import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import UpcomingEventsCard from "@/components/excon/UpcomingEventsCard";
import ActivePatientsCard from "@/components/excon/ActivePatientsCard";
import EventHistoryCard from "@/components/excon/EventHistoryCard";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import { router } from "expo-router";

import { Alert, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { signOutOperator } from "@/services/authorization/OperatorSessionService";
import RoleModeSwitcher from "@/components/RoleModeSwitcher";
import { useExconRouteReadiness } from "@/hooks/useExconRouteReadiness";
import { ExconRouteReadinessBoundary } from "@/components/excon/ExconRouteReadinessBoundary";

export default function ExconScreen() {
  const readiness = useExconRouteReadiness();
  return <ExconRouteReadinessBoundary readiness={readiness}>
    <AuthorizedExconScreen />
  </ExconRouteReadinessBoundary>;
}

function AuthorizedExconScreen() {
  const operator = useOperatorSession();
  const signOut = () => void signOutOperator().then(() => router.replace("/"))
    .catch(() => Alert.alert("Väljalogimine ebaõnnestus", "Väljalogimine ei õnnestunud täielikult. Proovi uuesti."));

  const [snapshot, setSnapshot] = useState({

    ...getCanonicalExerciseSnapshot(),

  });
  useEffect(() => {

    return subscribeToSync(() => {

      setSnapshot({

        ...getCanonicalExerciseSnapshot(),

      });

    });

  }, []);

  return (

    <ScrollView contentContainerStyle={styles.container}>

      <Text style={styles.title}>Õppuse juhtimine</Text>

      <RoleModeSwitcher />

      <Text style={styles.subtitle}>EXCON · Õppuse juhtimiskeskus</Text>
      {operator.state === "AUTHENTICATED" && <Text style={styles.operator}>Operaator: {operator.profile.displayName}</Text>}

      <Pressable style={styles.instructorButton} onPress={() => router.push("/excon/dashboard")}>
        <Text style={styles.instructorButtonText}>Ava õppuse töölaud</Text>
      </Pressable>

      <Pressable style={styles.catalogButton} onPress={() => router.push("/excon/catalog")}>
        <Text style={styles.instructorButtonText}>Uue õppuse pakettide kataloog</Text>
      </Pressable>

      <ExerciseStatusCard snapshot={snapshot} />

      <ActivePatientsCard />

      <UpcomingEventsCard session={{ exerciseId: snapshot.exerciseId, state: snapshot.lifecycleState === "RUNNING" ? "running" : snapshot.lifecycleState === "PAUSED" ? "paused" : "stopped", currentMinute: snapshot.simulationTimeSec / 60, speed: snapshot.speed }} />

      <EventHistoryCard />

      <Pressable style={styles.logoutButton} onPress={signOut}><Text style={styles.logoutButtonText}>Logi välja</Text></Pressable>

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
  backButtonText: {
    color: "#005BBB",
    fontWeight: "bold",
    fontSize: 18,
  },

});
