import {

  getExerciseSession,

  pauseExerciseSession,

  setExerciseSpeed,

  startExerciseSession,

} from "@/repositories/ExerciseSessionRepository";

import { advanceExerciseMinutes } from "@/services/ClockService";

import {

  startClockRunner,

} from "@/services/ClockRunner";

import { resetExercise } from "@/services/ExerciseResetService";

import { notifySync } from "@/services/SyncService";

import { Pressable, StyleSheet, Text, View } from "react-native";

const SPEEDS = [1, 2, 5, 10] as const;

type Props = {

  onSessionChange: () => void;

};

export default function ExerciseControlsCard({

  onSessionChange,

}: Props) {

  const session = getExerciseSession();

  function refresh(): void {

    notifySync();

    onSessionChange();

  }

  return (

    <View style={styles.card}>

      <Text style={styles.title}>Juhtimine</Text>

      <Pressable
        style={styles.button}
        onPress={() => {


          startExerciseSession();



          startClockRunner();
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

          resetExercise();
          onSessionChange();

        }}

      >

        <Text style={styles.buttonText}>⏹ Stop</Text>

      </Pressable>

      <View style={styles.row}>

        <Pressable

          style={styles.smallButton}

          onPress={() => {

            advanceExerciseMinutes(1);

            refresh();

          }}

        >

          <Text style={styles.buttonText}>+1 min</Text>

        </Pressable>

        <Pressable

          style={styles.smallButton}

          onPress={() => advanceExerciseMinutes(5)}

        >

          <Text style={styles.buttonText}>+5 min</Text>

        </Pressable>

      </View>

      <Text style={styles.sectionLabel}>Kiirus</Text>

      <View style={styles.row}>

        {SPEEDS.map((speed) => (

          <Pressable

            key={speed}

            style={

              session.speed === speed

                ? styles.activeSmallButton

                : styles.smallButton

            }

            onPress={() => {

              setExerciseSpeed(speed);

              refresh();

            }}

          >

            <Text style={styles.buttonText}>×{speed}</Text>

          </Pressable>

        ))}

      </View>

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

  sectionLabel: {

    marginTop: 16,

    marginBottom: 8,

    fontSize: 16,

    fontWeight: "600",

  },

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginBottom: 10,

  },

  row: {

    flexDirection: "row",

    gap: 10,

    marginTop: 2,

  },

  smallButton: {

    flex: 1,

    backgroundColor: "#005BBB",

    paddingVertical: 12,

    borderRadius: 12,

    alignItems: "center",

  },

  activeSmallButton: {

    flex: 1,

    backgroundColor: "#2E7D32",

    paddingVertical: 12,

    borderRadius: 12,

    alignItems: "center",

  },

  buttonText: {

    color: "#fff",

    fontWeight: "bold",

    fontSize: 18,

  },

});
