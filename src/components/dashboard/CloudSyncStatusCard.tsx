import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  getCloudSyncStatus,
  subscribeToCloudSyncStatus,
  type CloudSyncStatus,
} from "@/services/CloudSyncService";
import { getRuntimeCheckpointSyncStatus, reacquireRuntimeFromRemoteCheckpoint, subscribeToRuntimeCheckpointSync, takeOverRuntimeWriter } from "@/services/RuntimeCheckpointSyncService";
import { authorityStateLabel } from "@/localization/et";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { router } from "expo-router";

export async function resumeRuntime(
  resume: typeof takeOverRuntimeWriter = takeOverRuntimeWriter,
) {
  return resume();
}

export async function recoverRuntimeFromRemoteCheckpoint(
  recover: typeof reacquireRuntimeFromRemoteCheckpoint = reacquireRuntimeFromRemoteCheckpoint,
) {
  return recover();
}

export function getRuntimeAuthorityPresentation(
  lifecycleState: CanonicalExerciseSnapshot["lifecycleState"],
  runtimeStatus: ReturnType<typeof getRuntimeCheckpointSyncStatus>,
) {
  const runtimeActive = lifecycleState === "RUNNING" || lifecycleState === "PAUSED";
  if (!runtimeActive) {
    return Object.freeze({ label: "Runtime peatatud", takeoverVisible: false });
  }
  return Object.freeze({
    label: runtimeStatus.state === "WRITER" ? `${authorityStateLabel("WRITER")} · versioon ${runtimeStatus.revision ?? 0}`
      : runtimeStatus.state === "READER" ? "Simulatsioon töötab teises seadmes · ainult vaatamine"
      : runtimeStatus.state === "CONFLICT" ? `Juhtimisõiguse konflikt: ${runtimeStatus.code ?? "tundmatu"}`
      : runtimeStatus.state === "OFFLINE" ? "Simulatsiooni kontrollpunkti teenus pole saadaval"
      : runtimeStatus.state === "FAILED" ? `Juhtimisõiguse käivitamine ebaõnnestus: ${runtimeStatus.code ?? "tundmatu"}`
      : authorityStateLabel("CONNECTING"),
    takeoverVisible: runtimeStatus.state === "READER",
  });
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

export default function CloudSyncStatusCard({ lifecycleState }: { lifecycleState: CanonicalExerciseSnapshot["lifecycleState"] }) {
  const [status, setStatus] = useState(getCloudSyncStatus);
  const [runtimeStatus, setRuntimeStatus] = useState(getRuntimeCheckpointSyncStatus);
  const [takeoverPending, setTakeoverPending] = useState(false);

  useEffect(
    () => subscribeToCloudSyncStatus((next) => setStatus({ ...next })),
    []
  );
  useEffect(() => subscribeToRuntimeCheckpointSync((next) => setRuntimeStatus({ ...next })), []);

  const hasProblem = status.state === "error" || status.state === "offline";
  const isBusy = status.state === "connecting" || status.state === "saving";
  const runtimePresentation = getRuntimeAuthorityPresentation(lifecycleState, runtimeStatus);
  const multipleExerciseConflict = status.state === "error" && status.message?.startsWith("MULTIPLE_ACTIVE_EXERCISES:");
  const recoverableRevisionConflict = runtimeStatus.state === "CONFLICT" && runtimeStatus.code === "CHECKPOINT_REVISION_CONFLICT";

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
          {runtimePresentation.label}
        </Text>
        {runtimePresentation.takeoverVisible && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            disabled={takeoverPending}
            style={[styles.takeoverButton, takeoverPending && styles.takeoverButtonDisabled]}
            onPress={() => {
              setTakeoverPending(true);
              void resumeRuntime().finally(() => setTakeoverPending(false));
            }}
          >
            <Text style={styles.takeoverText}>
              {takeoverPending ? "Võtan Runtime’i üle…" : "Võta Runtime üle"}
            </Text>
          </Pressable>
        )}
        {recoverableRevisionConflict && (
          <Pressable testID="runtime-checkpoint-recovery" accessibilityRole="button"
            accessibilityLabel="Taasta pilve kontrollpunktist" hitSlop={8} disabled={takeoverPending}
            style={[styles.takeoverButton, takeoverPending && styles.takeoverButtonDisabled]}
            onPress={() => { setTakeoverPending(true); void recoverRuntimeFromRemoteCheckpoint().finally(() => setTakeoverPending(false)); }}>
            <Text style={styles.takeoverText}>{takeoverPending ? "Taastan Runtime’i…" : "Taasta pilve kontrollpunktist"}</Text>
          </Pressable>
        )}
        {multipleExerciseConflict && <Pressable style={styles.takeoverButton} onPress={() => router.push("/excon/active-exercise-conflict" as never)}><Text style={styles.takeoverText}>Lahenda aktiivsete õppuste konflikt</Text></Pressable>}
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
  takeoverButtonDisabled: { opacity: 0.65 },
});
