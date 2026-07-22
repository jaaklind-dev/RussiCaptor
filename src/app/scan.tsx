import { router } from "expo-router";

import { useState } from "react";

import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";

import {
  assignPatientToMe,
  getPendingPatientTransfer,
  requestPatientTakeover,
} from "@/services/AssignmentRepository";
import { findPatientByNationalId } from "@/repositories/PatientRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { updatePatientLocationFromCurrentCm } from "@/services/PatientLocationService";
import QrScanner from "@/components/QrScanner";
import { readQrCode } from "@/services/QrCodeService";

export default function ScanScreen() {

  const [nationalId, setNationalId] = useState("38701032343");

  function handleFindPatient(value = nationalId) {

    const patient = findPatientByNationalId(value);

    if (!patient) {

      Alert.alert("Patsienti ei leitud", value);

      return;

    }

const assignmentResult = assignPatientToMe(patient.id);

if (assignmentResult.status === "unavailable") {
  Alert.alert(
    "Patsienti ei saa määrata",
    patient.status === "Completed"
      ? "Patsiendi käsitlus on lõpetatud. Säilinud andmed leiad History vaatest."
      : "Patsient on üle antud ja teda ei saa aktiivnimekirja lisada."
  );
  return;
}

if (assignmentResult.status === "assigned-to-other") {
  const pendingTransfer = getPendingPatientTransfer(patient.id);

  if (pendingTransfer?.toCaseManagerId === getCurrentCaseManager().id) {
    Alert.alert(
      "Ülevõtmistaotlus on saadetud",
      `Ootab Case Manageri ${pendingTransfer.fromCaseManagerName} otsust.`
    );
    return;
  }

  Alert.alert(
    "Taotle patsiendi ülevõtmist?",
    `Praegune Case Manager: ${assignmentResult.assignment.caseManagerName}.`,
    [
      { text: "Katkesta", style: "cancel" },
      {
        text: "Saada taotlus",
        onPress: () => requestPatientTakeover(
          patient.id,
          getCurrentCaseManager()
        ),
      },
    ]
  );
  return;
}

updatePatientLocationFromCurrentCm(patient.id);

router.push(`/patient/${patient.id}`);

  }

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>Scan Patient</Text>

      <Text style={styles.subtitle}>Sisesta või skaneeri patsiendi isikukood</Text>

      <QrScanner
        buttonLabel="Scan Patient QR"
        onScanned={(data) => {
          const result = readQrCode(data, "patient");

          if (result.status === "wrong-type") {
            Alert.alert("Vale QR-kood", "See on asukoha QR-kood.");
            return;
          }

          if (result.status === "invalid") {
            Alert.alert("QR-koodi ei saanud lugeda");
            return;
          }

          setNationalId(result.value);
          handleFindPatient(result.value);
        }}
      />

      <TextInput

        style={styles.input}

        value={nationalId}

        onChangeText={setNationalId}

        keyboardType="number-pad"

        placeholder="Isikukood"

      />

      <Pressable style={styles.button} onPress={() => handleFindPatient()}>

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
