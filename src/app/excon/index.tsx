import ExerciseControlsCard from "@/components/excon/ExerciseControlsCard";

import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import {
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import UpcomingEventsCard from "@/components/excon/UpcomingEventsCard";


export default function ExconScreen() {

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {

    return subscribeToSync(() => {

      setRefreshKey((k) => k + 1);

    });

  }, []);

  return (

    <ScrollView contentContainerStyle={styles.container}>

      <Text style={styles.title}>EXCON</Text>

      <Text style={styles.subtitle}>Õppuse juhtimiskeskus</Text>

     <ExerciseStatusCard key={`status-${refreshKey}`} />
     <ExerciseControlsCard key={`controls-${refreshKey}`} />
     <UpcomingEventsCard key={`events-${refreshKey}`} />

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