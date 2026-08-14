import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  getCloudSyncStatus,
  subscribeToCloudSyncStatus,
  type CloudSyncStatus,
} from "@/services/CloudSyncService";
import { getRuntimeCheckpointSyncStatus, subscribeToRuntimeCheckpointSync, takeOverRuntimeWriter } from "@/services/RuntimeCheckpointSyncService";

export async function resumeRuntime(
  resume: typeof takeOverRuntimeWriter = takeOverRuntimeWriter,
) {
  return resume();
}

function statusText(status: CloudSyncStatus): string {
  switch (status.state) {
    case "disabled":
      return "Pilvesünkroniseerimine pole seadistatud";
    case "connecting":
      return "Ühendan Supabase’iga…";
    case "saving":
      return "Salvestan pilve…";
    case "offline":
      return "Ühendus puudub – andmed on seadmes alles";
    case "error":
      return "Pilvesünkroniseerimine vajab seadistamist";
    case "synced": {
      if (!status.syncedAt) return "Supabase’iga sünkroniseeritud";
      const time = new Date(status.syncedAt).toLocaleTimeString("et-EE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `Supabase’iga sünkroniseeritud kell ${time}`;
    }
  }
}

export default function CloudSyncStatusCard() {
  const [status, setStatus] = useState(getCloudSyncStatus);
  const [runtimeStatus, setRuntimeStatus] = useState(getRuntimeCheckpointSyncStatus);

  useEffect(
    () => subscribeToCloudSyncStatus((next) => setStatus({ ...next })),
    []
  );
  useEffect(() => subscribeToRuntimeCheckpointSync((next) => setRuntimeStatus({ ...next })), []);

  const hasProblem = status.state === "error" || status.state === "offline";
  const isBusy = status.state === "connecting" || status.state === "saving";

  return (
      <View style={[styles.card, hasProblem && styles.problemCard]}>
      <View
        style={[
          styles.indicator,
          isBusy && styles.busyIndicator,
          hasProblem && styles.problemIndicator,
        ]}
      />
      <View style={styles.textBlock}>
        <Text style={[styles.title, hasProblem && styles.problemText]}>
          {statusText(status)}
        </Text>
        <Text style={styles.caption}>
          {hasProblem
            ? status.message ?? "Sünkroniseerimine jätkub ühenduse taastumisel."
            : "Muudatused jõuavad teiste õppuse seadmeteni reaalajas."}
        </Text>
        <Text style={styles.caption}>
          {runtimeStatus.state === "WRITER" ? `Runtime writer · rev ${runtimeStatus.revision ?? 0}`
            : runtimeStatus.state === "READER" ? "Runtime active on another device · read-only"
            : runtimeStatus.state === "CONFLICT" ? `Runtime authority conflict: ${runtimeStatus.code ?? "unknown"}`
            : runtimeStatus.state === "OFFLINE" ? "Runtime checkpoint backend unavailable"
            : runtimeStatus.state === "FAILED" ? `Runtime authority startup failed: ${runtimeStatus.code ?? "unknown"}`
            : "Runtime checkpoint authority connecting"}
        </Text>
        {runtimeStatus.state === "READER" && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={styles.takeoverButton}
            onPress={() => void resumeRuntime()}
          >
            <Text style={styles.takeoverText}>Resume Runtime</Text>
          </Pressable>
        )}
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
    backgroundColor: "#EFF8FF",
    borderColor: "#B2DDFF",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  problemCard: {
    backgroundColor: "#FFF6ED",
    borderColor: "#FFD6AE",
  },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#1570EF",
  },
  busyIndicator: {
    backgroundColor: "#F79009",
  },
  problemIndicator: {
    backgroundColor: "#E62E05",
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: "#175CD3",
    fontSize: 14,
    fontWeight: "700",
  },
  caption: {
    color: "#667085",
    fontSize: 12,
    marginTop: 2,
  },
  problemText: {
    color: "#B93815",
  },
  takeoverButton: {
    alignSelf: "stretch",
    minHeight: 48,
    marginTop: 8,
    backgroundColor: "#175CD3",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  takeoverText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
