import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  buttonLabel?: string;
  onScanned: (data: string) => void;
};

export default function QrScanner({
  buttonLabel = "Skaneeri QR-kood",
  onScanned,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  async function openScanner(): Promise<void> {
    const currentPermission = permission?.granted
      ? permission
      : await requestPermission();

    if (currentPermission.granted) {
      setHasScanned(false);
      setIsOpen(true);
    }
  }

  if (!isOpen) {
    return (
      <Pressable style={styles.scanButton} onPress={openScanner}>
        <Text style={styles.scanButtonText}>{buttonLabel}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.scannerBlock}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={hasScanned ? undefined : ({ data }) => {
          setHasScanned(true);
          setIsOpen(false);
          onScanned(data);
        }}
      />
      <Text style={styles.hint}>Suuna kaamera QR-koodile</Text>
      <Pressable style={styles.cancelButton} onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelButtonText}>Katkesta</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#1570EF",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  scanButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  scannerBlock: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    marginBottom: 16,
  },
  camera: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  hint: {
    color: "#475467",
    marginTop: 8,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  cancelButtonText: {
    color: "#B42318",
    fontWeight: "700",
  },
});
