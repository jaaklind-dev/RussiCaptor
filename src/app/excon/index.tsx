import ExerciseControlsCard from "@/components/excon/ExerciseControlsCard";

import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import UpcomingEventsCard from "@/components/excon/UpcomingEventsCard";

import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import { ScrollView, StyleSheet, Text } from "react-native";

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

      <Text style={styles.title}>EXCON</Text>

      <Text style={styles.subtitle}>Õppuse juhtimiskeskus</Text>

      <ExerciseStatusCard session={session} />

<ExerciseControlsCard onSessionChange={refreshSession} />

      <UpcomingEventsCard session={session} />

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

});