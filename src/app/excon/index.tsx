import ExerciseControlsCard from "@/components/excon/ExerciseControlsCard";

import ExerciseStatusCard from "@/components/excon/ExerciseStatusCard";

import { subscribeToSync } from "@/services/SyncService";

import { useEffect, useState } from "react";

import { StyleSheet, Text, View } from "react-native";

export default function ExconScreen() {

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {

    return subscribeToSync(() => {

      setRefreshKey((k) => k + 1);

    });

  }, []);

  return (

    <View style={styles.container}>

      <Text style={styles.title}>EXCON</Text>

      <Text style={styles.subtitle}>Õppuse juhtimiskeskus</Text>

      <ExerciseStatusCard key={refreshKey} />

      <ExerciseControlsCard />

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

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