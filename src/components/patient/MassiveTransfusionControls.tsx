import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState, useSyncExternalStore } from "react";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots } from "@/services/RuntimeSnapshotService";
import { createMtpCommandId, handleMtpCommand, type MtpAction } from "@/services/runtime/instructor/MassiveTransfusionCommandService";
import type { BloodProductDeliveryMode } from "@/models/MassiveTransfusion";

type MtpProjection = Readonly<{
  activated?: boolean;
  completedRbcUnitsTotal?: number;
  completedRbcUnitsSinceLastCalcium?: number;
  rbcUnitsPerCalcium?: number | null;
  calciumRecommended?: boolean;
  vascularAccessCount?: number;
  vascularAccessLines?: readonly Readonly<{ lineId: string; status: "MISSING" | "FREE" | "OCCUPIED"; accessType?: string; administrationId?: string }>[];
  administrations?: readonly Readonly<{ administrationId: string; product: string; state: string; deliveryMode?: BloodProductDeliveryMode; expectedCompletionAtSec?: number }>[];
}>;

const actions: readonly Readonly<{ action: MtpAction; label: string }>[] = [
  { action: "MTP_ACTIVATION", label: "Aktiveeri MTP" },
  { action: "RBC_ADMINISTRATION", label: "Manusta 1 ühik erütrotsüüte" },
  { action: "PLASMA_ADMINISTRATION", label: "Manusta 1 ühik plasmat" },
  { action: "PLATELET_ADMINISTRATION", label: "Manusta 1 doos trombotsüüte" },
];

export function MassiveTransfusionControls({ patientId, readOnly = false }: Readonly<{ patientId: string; readOnly?: boolean }>) {
  const version = useSyncExternalStore(subscribeToRuntimeSnapshots, getRuntimeSnapshotVersion, getRuntimeSnapshotVersion);
  const runtimeSnapshot = getCanonicalPatientRuntimeSnapshot(patientId, version);
  const process = runtimeSnapshot?.processes.find(item => item.moduleId === "MASSIVE_TRANSFUSION_V1");
  const state = process?.clinicalState as MtpProjection | undefined;
  const [submitting, setSubmitting] = useState<MtpAction>();
  const [message, setMessage] = useState<string>();
  const [deliveryMode, setDeliveryMode] = useState<BloodProductDeliveryMode>("GRAVITY");
  if (!process) return null;

  const submit = (action: MtpAction) => {
    if (submitting || readOnly) return;
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    const commandId = createMtpCommandId(exerciseId, patientId, action);
    setSubmitting(action); setMessage(undefined);
    const result = handleMtpCommand({ commandId, exerciseId, patientId, action, units: 1, issuedBy: "Case Manager", deliveryMode });
    setMessage(result.ok ? "Korraldus rakendati." : result.message); setSubmitting(undefined);
  };

  return <View style={styles.card} testID="cm-mtp-controls">
    <Text style={styles.title}>Massiivse transfusiooni protokoll</Text>
    <Text style={styles.status}>Lõpetatud erütrotsüüdiühikuid: {state?.completedRbcUnitsTotal ?? 0}</Text>
    {state?.vascularAccessLines && <View style={styles.accessCard}>
      <Text style={styles.status}>Veeniteed: {state.vascularAccessCount ?? 0}/3</Text>
      {state.vascularAccessLines.map(line => { const administration = state.administrations?.find(item => item.administrationId === line.administrationId);
        const remaining = administration?.expectedCompletionAtSec === undefined ? undefined : Math.max(0, administration.expectedCompletionAtSec - (runtimeSnapshot?.state.exerciseTimeSec ?? 0));
        return <Text key={line.lineId} style={line.status === "OCCUPIED" ? styles.due : styles.status}>{line.lineId}: {line.status === "MISSING" ? "PUUDUB" : line.status === "FREE"
          ? `VABA · ${line.accessType === "CENTRAL_ACCESS" ? "tsentraalveenitee" : "perifeerne veenitee"}` :
            `HÕIVATUD · ${administration?.product ?? "verekomponent"} · ${administration?.deliveryMode ?? ""} · ${remaining ?? "?"} s`}</Text>; })}
      {!readOnly && <View style={styles.row}>{(["GRAVITY", "PRESSURE_BAG", "RAPID_INFUSER"] as const).map(mode => <Pressable key={mode}
        onPress={() => setDeliveryMode(mode)} style={mode === deliveryMode ? styles.choiceSelected : styles.choice}>
        <Text style={styles.choiceText}>{({ GRAVITY: "Vabavool", PRESSURE_BAG: "Survekott", RAPID_INFUSER: "Verepump/soojendaja" } as const)[mode]}</Text>
      </Pressable>)}</View>}
    </View>}
    <Text style={state?.calciumRecommended ? styles.due : styles.status}>
      {state?.calciumRecommended ? "Kaltsium on näidustatud" : state?.rbcUnitsPerCalcium
        ? `Kaltsium on näidustatud pärast ${state.rbcUnitsPerCalcium} lõpetatud erütrotsüüdiühikut · ${state?.completedRbcUnitsSinceLastCalcium ?? 0}/${state.rbcUnitsPerCalcium}`
        : "Kaltsiumiasendus ei ole selles protokollis kasutusel"}
    </Text>
    {!readOnly && actions.map(({ action, label }) => <Pressable key={action} disabled={Boolean(submitting)}
      onPress={() => submit(action)} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>)}
    {!readOnly && state?.activated && state?.rbcUnitsPerCalcium && <Pressable testID="administer-calcium" disabled={Boolean(submitting)}
      onPress={() => submit("CALCIUM_ADMINISTRATION")} style={styles.calciumButton}>
      <Text style={styles.buttonText}>Manusta kaltsiumi</Text>
    </Pressable>}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff7ed", borderColor: "#fdba74", borderWidth: 1, borderRadius: 12, padding: 14, gap: 8, marginBottom: 18 },
  title: { color: "#9a3412", fontSize: 18, fontWeight: "900" },
  status: { color: "#7c2d12" }, due: { color: "#b91c1c", fontWeight: "900" },
  button: { backgroundColor: "#9a3412", padding: 12, borderRadius: 10, alignItems: "center" },
  calciumButton: { backgroundColor: "#b91c1c", padding: 12, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }, message: { color: "#7c2d12", fontWeight: "700" },
  accessCard: { gap: 6, borderWidth: 1, borderColor: "#fdba74", borderRadius: 8, padding: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { backgroundColor: "#7c2d12", borderRadius: 7, padding: 8 },
  choiceSelected: { backgroundColor: "#c2410c", borderRadius: 7, padding: 8, borderWidth: 2, borderColor: "#fed7aa" },
  choiceText: { color: "#fff", fontWeight: "800" },
});
