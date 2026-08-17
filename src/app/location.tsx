import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";
import { findLocationZoneByCode } from "@/repositories/LocationRepository";
import { setCurrentLocationZone } from "@/services/CurrentLocationService";
import QrScanner from "@/components/QrScanner";
import { readQrCode } from "@/services/QrCodeService";

export default function LocationScanScreen() {
  const [code, setCode] = useState("LOC-ICU-2");

  function applyLocation(value = code): void {
    const qrResult = readQrCode(value, "location");

    if (qrResult.status !== "valid") {
      Alert.alert(
        "Asukohatsooni ei leitud",
        qrResult.status === "wrong-type"
          ? "See on patsiendi QR-kood."
          : value.trim()
      );
      return;
    }

    const zone = findLocationZoneByCode(qrResult.value);

    if (!zone) {
      Alert.alert("Asukohatsooni ei leitud", qrResult.value);
      return;
    }

    setCurrentLocationZone(zone);
    router.back();
  }

  return (
    <View style={styles.container}>
      <AppHeader />
      <Text style={styles.title}>Skaneeri asukoht</Text>
      <Text style={styles.subtitle}>Skaneeri või sisesta asukohatsooni kood</Text>
      <QrScanner
        buttonLabel="Skaneeri asukoha QR-kood"
        onScanned={(data) => {
          const result = readQrCode(data, "location");

          if (result.status === "wrong-type") {
            Alert.alert("Vale QR-kood", "See on patsiendi QR-kood.");
            return;
          }

          if (result.status === "invalid") {
            Alert.alert("QR-koodi ei saanud lugeda");
            return;
          }

          setCode(result.value);
          applyLocation(result.value);
        }}
      />
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="Tsooni kood"
      />
      <Pressable style={styles.button} onPress={() => applyLocation()}>
        <Text style={styles.buttonText}>Määra juhtumikorraldaja asukoht</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryButtonText}>Tagasi</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: { fontSize: 38, fontWeight: "bold", marginBottom: 12 },
  subtitle: { fontSize: 18, color: "#555", marginBottom: 24, textAlign: "center" },
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
  },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 18 },
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
  secondaryButtonText: { color: "#005BBB", fontWeight: "bold", fontSize: 18 },
});
