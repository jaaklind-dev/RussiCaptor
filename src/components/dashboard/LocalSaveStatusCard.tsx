import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getLocalSaveStatus,
  subscribeToLocalSaveStatus,
  type LocalSaveStatus,
} from "@/services/StatePersistenceService";

function getStatusText(status: LocalSaveStatus): string {
  if (status.state === "saving") {
    return "Salvestan seadmesse…";
  }

  if (status.state === "error") {
    return "Kohalik salvestamine ebaõnnestus";
  }

  if (status.state === "saved" && status.savedAt) {
    const savedTime = new Date(status.savedAt).toLocaleTimeString("et-EE", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return `Seadmesse salvestatud kell ${savedTime}`;
  }

  return "Kohalik salvestamine on valmis";
}

export default function LocalSaveStatusCard() {
  const [status, setStatus] = useState(getLocalSaveStatus);

  useEffect(() => subscribeToLocalSaveStatus((nextStatus) => {
    setStatus({ ...nextStatus });
  }), []);

  const hasError = status.state === "error";

  return (
    <View style={[styles.card, hasError && styles.errorCard]}>
      <View
        style={[
          styles.indicator,
          status.state === "saving" && styles.savingIndicator,
          hasError && styles.errorIndicator,
        ]}
      />
      <View style={styles.textBlock}>
        <Text style={[styles.title, hasError && styles.errorText]}>
          {getStatusText(status)}
        </Text>
        <Text style={styles.caption}>Kohalik koopia töötab ka internetiühenduseta</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ECFDF3",
    borderColor: "#ABEFC6",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
  },
  errorCard: {
    backgroundColor: "#FEF3F2",
    borderColor: "#FECDCA",
  },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#17B26A",
  },
  savingIndicator: {
    backgroundColor: "#F79009",
  },
  errorIndicator: {
    backgroundColor: "#D92D20",
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: "#067647",
    fontSize: 14,
    fontWeight: "700",
  },
  caption: {
    color: "#667085",
    fontSize: 12,
    marginTop: 2,
  },
  errorText: {
    color: "#B42318",
  },
});
