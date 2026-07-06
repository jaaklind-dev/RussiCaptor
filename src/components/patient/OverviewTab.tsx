import { StyleSheet, Text, View } from "react-native";

import { Patient } from "@/models/Patient";

type Props = {

  patient: Patient;

};

export default function OverviewTab({ patient }: Props) {

  return (

    <View style={styles.card}>

      <Text style={styles.sectionTitle}>MIST</Text>

      <Text style={styles.row}>

        <Text style={styles.label}>M:</Text> {patient.mist.mechanism}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>I:</Text> {patient.mist.injuries}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>S:</Text> {patient.mist.signs}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>T:</Text> {patient.mist.treatment}

      </Text>

    </View>

  );

}

const styles = StyleSheet.create({

  card: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

  },

  sectionTitle: {

    fontSize: 22,

    fontWeight: "bold",

    marginBottom: 14,

  },

  label: {

    fontWeight: "bold",

  },

  row: {

    fontSize: 16,

    lineHeight: 24,

    marginBottom: 10,

  },

});