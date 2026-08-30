import { router } from "expo-router";

import { useRef, useState } from "react";

import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput } from "react-native";

import AppHeader from "@/components/AppHeader";

import {
  assignPatientToMeConflictSafe,
  getPendingPatientTransfer,
  requestPatientTakeoverConflictSafe,
} from "@/services/AssignmentRepository";
import { findPatientByNationalId } from "@/repositories/PatientRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { updatePatientLocationFromCurrentCmConflictSafe } from "@/services/PatientLocationService";
import QrScanner from "@/components/QrScanner";
import { readQrCode } from "@/services/QrCodeService";
import { getInstalledWorkbook } from "@/services/WorkbookImportService";
import { getPatientNotFoundMessage } from "@/services/PatientLookupFeedback";
import { SingleFlightActionGate } from "@/services/ui/InteractionSafety";

export default function ScanScreen() {

  const [nationalId, setNationalId] = useState("");
  const [pending, setPending] = useState(false);
  const gate = useRef(new SingleFlightActionGate()).current;

  function handleFindPatient(value = nationalId): Promise<void> {
    setPending(true);
    return gate.run(() => findAndClaimPatient(value)).finally(() => setPending(false));
  }

  async function findAndClaimPatient(value: string): Promise<void> {

    const qrResult = readQrCode(value, "patient");

    if (qrResult.status === "wrong-type") {
      Alert.alert("Vale QR-kood", "See on asukoha QR-kood.");
      return;
    }

    if (qrResult.status === "invalid") {
      Alert.alert(
        "Isikukood puudub",
        "Sisesta patsiendi isikukood või skaneeri patsiendi QR-kood."
      );
      return;
    }

    const patient = findPatientByNationalId(qrResult.value);

    if (!patient) {

      Alert.alert(
        "Patsienti ei leitud",
        getPatientNotFoundMessage(
          qrResult.value,
          getInstalledWorkbook()?.fileName
        )
      );

      return;

    }

const assignmentOutcome = await assignPatientToMeConflictSafe(patient.id);
const assignmentResult = assignmentOutcome.value;
if (!assignmentResult) { Alert.alert("Patsienti ei määratud", assignmentOutcome.message); return; }

if (assignmentResult.status === "unavailable") {
  Alert.alert(
    "Patsienti ei saa määrata",
    patient.status === "Completed"
      ? "Patsiendi käsitlus on lõpetatud. Säilinud andmed leiad ajaloo vaatest."
      : "Patsient on üle antud ja teda ei saa aktiivnimekirja lisada."
  );
  return;
}

if (assignmentResult.status === "assigned-to-other") {
  const pendingTransfer = getPendingPatientTransfer(patient.id);

  if (pendingTransfer?.toCaseManagerId === getCurrentCaseManager().id) {
    Alert.alert(
      "Ülevõtmistaotlus on saadetud",
      `Ootab juhtumikorraldaja ${pendingTransfer.fromCaseManagerName} otsust.`
    );
    return;
  }

  Alert.alert(
    "Taotle patsiendi ülevõtmist?",
    `Praegune juhtumikorraldaja: ${assignmentResult.assignment.caseManagerName}.`,
    [
      { text: "Katkesta", style: "cancel" },
      {
        text: "Saada taotlus",
        onPress: () => void requestPatientTakeoverConflictSafe(
          patient.id,
          getCurrentCaseManager()
        ).then(outcome=>Alert.alert("Ülevõtmistaotlus",outcome.message)),
      },
    ]
  );
  return;
}

await updatePatientLocationFromCurrentCmConflictSafe(patient.id);

router.push(`/patient/${patient.id}`);

  }

  return (

    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>Skaneeri patsient</Text>

      <Text style={styles.subtitle}>Sisesta või skaneeri patsiendi isikukood</Text>

      <QrScanner
        buttonLabel="Skaneeri patsiendi QR-kood"
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
          void handleFindPatient(result.value);
        }}
      />

      <TextInput

        style={styles.input}

        value={nationalId}

        onChangeText={setNationalId}

        autoCapitalize="characters"

        autoCorrect={false}

        placeholder="Isikukood"

      />

      <Pressable accessibilityRole="button" accessibilityState={{ busy: pending, disabled: pending }} disabled={pending} style={[styles.button, pending && styles.disabled]} onPress={() => void handleFindPatient()}>

        {pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Otsi patsienti</Text>}

      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>

        <Text style={styles.secondaryButtonText}>Tagasi</Text>

      </Pressable>

    </KeyboardAvoidingView>

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
  disabled: { opacity: 0.6 },

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
