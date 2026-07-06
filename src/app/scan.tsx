import { router } from "expo-router";

import { useState } from "react";

import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";

import { assignPatientToMe } from "@/services/AssignmentRepository";
import { findPatientByNationalId } from "@/services/PatientRepository";

export default function ScanScreen() {

  const [nationalId, setNationalId] = useState("38701032343");

  function handleFindPatient() {

    const patient = findPatientByNationalId(nationalId);

    if (!patient) {

      Alert.alert("Patsienti ei leitud", nationalId);

      return;

    }

   assignPatientToMe(patient.id);

assignPatientToMe(patient.id);

router.push(`/patient/${patient.id}`);

  }

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>Scan Patient</Text>

      <Text style={styles.subtitle}>Sisesta või skaneeri patsiendi isikukood</Text>

      <TextInput

        style={styles.input}

        value={nationalId}

        onChangeText={setNationalId}

        keyboardType="number-pad"

        placeholder="Isikukood"

      />

      <Pressable style={styles.button} onPress={handleFindPatient}>

        <Text style={styles.buttonText}>Find Patient</Text>

      </Pressable>

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

    fontSize: 18,

    color: "#555",

    marginBottom: 24,

    textAlign: "center",

  },

  input: {

    width: "100%",

    maxWidth: 360,

    borderWidth: 2,

    borderColor: "#005BBB",

    borderRadius: 12,

    padding: 16,

    fontSize: 20,

    marginBottom: 16,

    textAlign: "center",

  },

  button: {

    width: "100%",

    maxWidth: 360,

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    borderRadius: 12,

    alignItems: "center",

    marginTop: 10,

  },

  buttonText: {

    color: "white",

    fontWeight: "bold",

    fontSize: 18,

  },

  secondaryButton: {

    width: "100%",

    maxWidth: 360,

    borderColor: "#005BBB",

    borderWidth: 2,

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginTop: 12,

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});