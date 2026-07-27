import * as DocumentPicker from "expo-document-picker";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  formatWorkbookErrors,
  getInstalledWorkbook,
  installWorkbook,
  readWorkbookFile,
} from "@/services/WorkbookImportService";
import {
  formatModuleImportIssues,
  getActiveModulePackageSummary,
  importModulePackage,
  moduleManifestFileName,
} from "@/services/ModuleImportService";

type Props = {
  onImported: () => void;
};

export default function WorkbookImportCard({ onImported }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [isModuleLoading, setIsModuleLoading] = useState(false);
  const [moduleStatus, setModuleStatus] = useState("Moodulipaketi oleku kontrollimine…");
  const [fileName, setFileName] = useState(
    getInstalledWorkbook()?.fileName ?? "Sisseehitatud demoandmed"
  );

  useEffect(() => {
    void getActiveModulePackageSummary().then((active) => {
      setModuleStatus(
        active
          ? `${active.exerciseId} v${active.exerciseVersion}`
          : "Aktiivset moodulipaketti pole"
      );
    });
  }, []);

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

  async function chooseModulePackage(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return;

    const assets = result.assets.map((asset) => ({ name: asset.name, uri: asset.uri }));
    if (!assets.some((asset) => asset.name === moduleManifestFileName)) {
      Alert.alert("Manifest puudub", `Valikus peab olema ${moduleManifestFileName}.`);
      return;
    }

    Alert.alert(
      "Impordi moodulipakett?",
      `${assets.length} faili kontrollitakse manifesti järgi. Aktiivne versioon muutub alles pärast kõigi FATAL kontrollide läbimist.`,
      [
        { text: "Katkesta", style: "cancel" },
        {
          text: "Kontrolli ja impordi",
          onPress: async () => {
            setIsModuleLoading(true);
            const imported = await importModulePackage(assets);
            setIsModuleLoading(false);
            if (!imported.ok) {
              Alert.alert("Moodulipaketi import ebaõnnestus", formatModuleImportIssues(imported.issues));
              return;
            }
            const status = imported.noOp
              ? `${imported.exerciseId} v${imported.exerciseVersion} oli juba aktiivne · muudatusi ei tehtud`
              : `${imported.exerciseId} v${imported.exerciseVersion} · ${imported.moduleCount} moodulit`;
            setModuleStatus(status);
            Alert.alert(imported.noOp ? "Pakett oli juba aktiivne" : "Moodulipakett aktiveeritud", status);
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
      <View style={styles.moduleDivider} />
      <Text style={styles.label}>Manifestipõhine pakett</Text>
      <Text style={styles.moduleStatus}>{moduleStatus}</Text>
      <Text style={styles.helpText}>
        Vali korraga manifest ja kõik selles registreeritud .xlsx moodulifailid. Import ei nulli praegust runtime-seisu.
      </Text>
      <Pressable
        style={[styles.secondaryButton, isModuleLoading && styles.disabledButton]}
        disabled={isModuleLoading || isLoading}
        onPress={chooseModulePackage}
      >
        <Text style={styles.secondaryButtonText}>
          {isModuleLoading ? "Paketi kontrollimine…" : "Import module package"}
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
  moduleDivider: { height: 1, backgroundColor: "#d0d5dd", marginVertical: 18 },
  moduleStatus: { color: "#101828", fontWeight: "600", marginTop: 4 },
  secondaryButton: {
    borderColor: "#005BBB",
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#005BBB", fontSize: 16, fontWeight: "bold" },
});
