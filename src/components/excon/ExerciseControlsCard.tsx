import {

  pauseExerciseSession,

  startExerciseSession,

  stopExerciseSession,

} from "@/repositories/ExerciseSessionRepository";

import { notifySync } from "@/services/SyncService";

import { Pressable, StyleSheet, Text, View } from "react-native";

export default function ExerciseControlsCard() {

  function refresh() {

    notifySync();

  }

  return (

    <View style={styles.card}>

      <Text style={styles.title}>Juhtimine</Text>

      <Pressable

        style={styles.button}

        onPress={() => {

          startExerciseSession();

          refresh();

        }}

      >

        <Text style={styles.buttonText}>▶ Start</Text>

      </Pressable>

      <Pressable

        style={styles.button}

        onPress={() => {

          pauseExerciseSession();

          refresh();

        }}

      >

        <Text style={styles.buttonText}>⏸ Pause</Text>

      </Pressable>

      <Pressable

        style={styles.button}

        onPress={() => {

          stopExerciseSession();

          refresh();

        }}

      >

        <Text style={styles.buttonText}>⏹ Stop</Text>

      </Pressable>

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

    marginBottom: 16,

  },

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginBottom: 10,

  },

  buttonText: {

    color: "#fff",

    fontWeight: "bold",

    fontSize: 18,

  },

});