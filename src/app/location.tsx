import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";
import { findLocationZoneByCode } from "@/repositories/LocationRepository";
import { setCurrentLocationZone } from "@/services/CurrentLocationService";

export default function LocationScanScreen() {
  const [code, setCode] = useState("LOC-ICU-2");

  function applyLocation(): void {
    const zone = findLocationZoneByCode(code);

    if (!zone) {
      Alert.alert("Asukohatsooni ei leitud", code.trim());
      return;
    }

    setCurrentLocationZone(zone);
    router.back();
  }

  return (
    <View style={styles.container}>
      <AppHeader />
      <Text style={styles.title}>Scan Location</Text>
      <Text style={styles.subtitle}>Skaneeri või sisesta asukohatsooni kood</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="Tsooni kood"
      />
      <Pressable style={styles.button} onPress={applyLocation}>
        <Text style={styles.buttonText}>Set CM Location</Text>
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
