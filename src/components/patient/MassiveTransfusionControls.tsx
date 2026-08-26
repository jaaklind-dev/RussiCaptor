import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState, useSyncExternalStore } from "react";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots } from "@/services/RuntimeSnapshotService";
import { createMtpCommandId, handleMtpCommand, type MtpAction } from "@/services/runtime/instructor/MassiveTransfusionCommandService";
import type { BloodProductDeliveryMode, VascularAccessLineId } from "@/models/MassiveTransfusion";

type MtpProjection = Readonly<{
  activated?: boolean;
  transfusionCalcium?: Readonly<{
    completedRbcUnitsTotal?: number;
    completedRbcUnitsSinceLastCalcium?: number;
    rbcUnitsPerCalcium?: number | null;
    calciumRecommended?: boolean;
  }>;
  vascularAccessCount?: number;
  vascularAccessLines?: readonly Readonly<{ lineId: string; status: "MISSING" | "FREE" | "OCCUPIED"; accessType?: string; administrationId?: string }>[];
  administrations?: readonly Readonly<{ administrationId: string; product: string; state: string; deliveryMode?: BloodProductDeliveryMode;
    deliveredVolumeMl?: number; totalVolumeMl?: number; expectedCompletionAtSec?: number }>[];
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
  const calcium = state?.transfusionCalcium;
  const [submitting, setSubmitting] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [selectedLineId, setSelectedLineId] = useState<VascularAccessLineId>();
  const [lineModes, setLineModes] = useState<Partial<Record<VascularAccessLineId, BloodProductDeliveryMode>>>({});
  if (!process) return null;

  const submit = (action: MtpAction) => {
    if (submitting || readOnly) return;
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    const commandId = createMtpCommandId(exerciseId, patientId, action);
    setSubmitting(action); setMessage(undefined);
    const freeLine = state?.vascularAccessLines?.find(line => line.status === "FREE" && (!selectedLineId || line.lineId === selectedLineId));
    const lineId = freeLine?.lineId as VascularAccessLineId | undefined;
    const deliveryMode = lineId ? lineModes[lineId] ?? "GRAVITY" : undefined;
    const result = handleMtpCommand({ commandId, exerciseId, patientId, action, units: 1, issuedBy: "Case Manager", deliveryMode, vascularAccessLineId: lineId });
    setMessage(result.ok ? "Korraldus rakendati." : result.message); setSubmitting(undefined);
  };

  const modes = ["GRAVITY", "PRESSURE_BAG", "RAPID_INFUSER"] as const;
  const modeLabel = { GRAVITY: "Vabavool", PRESSURE_BAG: "Survekott", RAPID_INFUSER: "Verepump/soojendaja" } as const;
  const chooseMode = (lineId: VascularAccessLineId, administrationId: string | undefined, mode: BloodProductDeliveryMode) => {
    setSelectedLineId(lineId);
    if (!administrationId) { setLineModes(current => ({ ...current, [lineId]: mode })); return; }
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    const action: MtpAction = "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE";
    const commandId = createMtpCommandId(exerciseId, patientId, action);
    setSubmitting(`${lineId}:${mode}`); setMessage(undefined);
    const result = handleMtpCommand({ commandId, exerciseId, patientId, action, units: 1, issuedBy: "Case Manager",
      deliveryMode: mode, vascularAccessLineId: lineId, administrationId });
    if (result.ok) setLineModes(current => ({ ...current, [lineId]: mode }));
    setMessage(result.ok ? `${lineId} manustamisviis muudeti.` : result.message); setSubmitting(undefined);
  };

  return <View style={styles.card} testID="cm-mtp-controls">
    <Text style={styles.title}>Massiivse transfusiooni protokoll</Text>
    <Text style={styles.status}>Lõpetatud erütrotsüüdiühikuid: {calcium?.completedRbcUnitsTotal ?? 0}</Text>
    {state?.vascularAccessLines && <View style={styles.accessCard}>
      <Text style={styles.status}>Veeniteed: {state.vascularAccessCount ?? 0}/3</Text>
      {state.vascularAccessLines.map(line => { const lineId = line.lineId as VascularAccessLineId; const administration = state.administrations?.find(item => item.administrationId === line.administrationId);
        const remaining = administration?.expectedCompletionAtSec === undefined ? undefined : Math.max(0, administration.expectedCompletionAtSec - (runtimeSnapshot?.state.exerciseTimeSec ?? 0));
        const activeMode = administration?.deliveryMode ?? lineModes[lineId] ?? "GRAVITY";
        return <View key={line.lineId} style={styles.line}><Pressable disabled={line.status !== "FREE"} onPress={() => setSelectedLineId(lineId)}>
          <Text style={line.status === "OCCUPIED" ? styles.due : selectedLineId === lineId ? styles.selectedLine : styles.status}>{line.lineId}: {line.status === "MISSING" ? "PUUDUB" : line.status === "FREE"
            ? `VABA · ${line.accessType === "CENTRAL_ACCESS" ? "tsentraalveenitee" : "perifeerne veenitee"}` :
              `HÕIVATUD · ${administration?.product ?? "verekomponent"} · ${activeMode} · ${administration?.deliveredVolumeMl ?? "?"}/${administration?.totalVolumeMl ?? "?"} ml · ${remaining ?? "?"} s`}</Text></Pressable>
          {!readOnly && line.status !== "MISSING" && <View style={styles.row}>{modes.map(mode => <Pressable key={mode}
            disabled={Boolean(submitting)} onPress={() => chooseMode(lineId, administration?.administrationId, mode)}
            style={mode === activeMode ? styles.choiceSelected : styles.choice}><Text style={styles.choiceText}>{modeLabel[mode]}</Text></Pressable>)}</View>}
        </View>; })}
    </View>}
    <Text style={calcium?.calciumRecommended ? styles.due : styles.status}>
      {calcium?.calciumRecommended ? "Kaltsium on näidustatud" : calcium?.rbcUnitsPerCalcium
        ? `Kaltsium on näidustatud pärast ${calcium.rbcUnitsPerCalcium} lõpetatud erütrotsüüdiühikut · ${calcium.completedRbcUnitsSinceLastCalcium ?? 0}/${calcium.rbcUnitsPerCalcium}`
        : "Kaltsiumiasendus ei ole selles protokollis kasutusel"}
    </Text>
    {!readOnly && actions.map(({ action, label }) => <Pressable key={action} disabled={Boolean(submitting)}
      onPress={() => submit(action)} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>)}
    {!readOnly && calcium?.rbcUnitsPerCalcium && <Pressable testID="administer-calcium" disabled={Boolean(submitting)}
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
  line: { gap: 5, paddingVertical: 4 }, selectedLine: { color: "#9a3412", fontWeight: "900", textDecorationLine: "underline" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { backgroundColor: "#7c2d12", borderRadius: 7, padding: 8 },
  choiceSelected: { backgroundColor: "#c2410c", borderRadius: 7, padding: 8, borderWidth: 2, borderColor: "#fed7aa" },
  choiceText: { color: "#fff", fontWeight: "800" },
});
