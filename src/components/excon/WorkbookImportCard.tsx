import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  formatWorkbookErrors,
  getInstalledWorkbook,
  installWorkbook,
  readWorkbookFile,
} from "@/services/WorkbookImportService";

type Props = {
  onImported: () => void;
};

export default function WorkbookImportCard({ onImported }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState(
    getInstalledWorkbook()?.fileName ?? "Sisseehitatud demoandmed"
  );

  async function chooseWorkbook(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setIsLoading(true);
    const parsed = await readWorkbookFile(asset.uri);
    setIsLoading(false);

    if (!parsed.ok) {
      Alert.alert(
        "Exceli import ebaõnnestus",
        formatWorkbookErrors(parsed.errors)
      );
      return;
    }

    Alert.alert(
      "Laadi uus harjutus?",
      `${asset.name}\n\nPraegune harjutuse seis nullitakse ja asendatakse Exceli andmetega.`,
      [
        { text: "Katkesta", style: "cancel" },
        {
          text: "Laadi",
          onPress: () => {
            installWorkbook(parsed.data, asset.name);
            setFileName(asset.name);
            onImported();
            Alert.alert(
              "Harjutus laaditud",
              `${parsed.data.patients.length} patsienti · ${parsed.data.locations.length} asukohta`
            );
          },
        },
      ]
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Harjutuse andmed</Text>
      <Text style={styles.label}>Aktiivne allikas</Text>
      <Text style={styles.fileName}>{fileName}</Text>
      <Text style={styles.helpText}>
        Vali RussiCaptori skeemile vastav .xlsx töövihik. Fail kontrollitakse enne laadimist.
      </Text>
      <Pressable
        style={[styles.button, isLoading && styles.disabledButton]}
        disabled={isLoading}
        onPress={chooseWorkbook}
      >
        <Text style={styles.buttonText}>
          {isLoading ? "Exceli kontrollimine…" : "Import Excel"}
        </Text>
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
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 14 },
  label: { color: "#667085", fontSize: 14, fontWeight: "600" },
  fileName: { color: "#101828", fontSize: 17, fontWeight: "700", marginTop: 4 },
  helpText: { color: "#475467", lineHeight: 21, marginTop: 10, marginBottom: 14 },
  button: {
    backgroundColor: "#005BBB",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  disabledButton: { opacity: 0.55 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "bold" },
});
