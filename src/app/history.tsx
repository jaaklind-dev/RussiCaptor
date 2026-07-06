import { router } from "expo-router";

import { Pressable, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

export default function HistoryScreen() {

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>History</Text>

      <Text style={styles.subtitle}>Veel ajalugu ei ole.</Text>

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>

        <Text style={styles.secondaryButtonText}>Back</Text>

      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "white",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 38,

    fontWeight: "bold",

    marginBottom: 12,

  },

  subtitle: {

    fontSize: 20,

    color: "#555",

    marginBottom: 24,

  },

  secondaryButton: {

    width: "100%",

    maxWidth: 360,

    borderColor: "#005BBB",

    borderWidth: 2,

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});