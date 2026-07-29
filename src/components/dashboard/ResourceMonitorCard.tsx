import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getResourceRuntimeDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import { summarizeCanonicalResources, summarizeResources } from "@/services/runtime/selectors/ResourceSelectors";

export default function ResourceMonitorCard() {
  useSyncExternalStore(
    subscribeToResourceRuntimeDebug,
    getResourceRuntimeDebugVersion,
    getResourceRuntimeDebugVersion
  );
  const snapshot = getResourceRuntimeDebugSnapshot();
  const rows = snapshot.allocationState
    ? summarizeCanonicalResources(snapshot.allocationState)
    : summarizeResources(snapshot.resources);
  const hemorrhage = snapshot.hemorrhageProcesses?.[0];
  const medications = snapshot.medicationState;
  const vitals = snapshot.vitalSignStates?.[0]?.state;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Resource Monitor</Text>
        <Text style={styles.badge}>DEV</Text>
      </View>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerText, styles.resourceColumn]}>Resource</Text>
        <Text style={styles.numberHeader}>Total</Text>
        <Text style={styles.numberHeader}>Free</Text>
        <Text style={styles.numberHeader}>In use</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty}>Resource runtime pole veel snapshot’i avaldanud.</Text>
      ) : rows.map(row => (
        <View key={row.type} style={styles.tableRow}>
          <Text style={[styles.resourceText, styles.resourceColumn]}>{row.label}</Text>
          <Text style={styles.numberText}>{row.total}</Text>
          <Text style={[styles.numberText, styles.freeText]}>{row.free}</Text>
          <Text style={[styles.numberText, row.inUse > 0 && styles.inUseText]}>{row.inUse}</Text>
        </View>
      ))}
      {hemorrhage && (
        <View style={styles.clinicalBlock}>
          <Text style={styles.clinicalTitle}>Hemorrhage · {hemorrhage.clinicalState.severity}</Text>
          <Text style={styles.clinicalText}>Perfusion: {hemorrhage.clinicalState.perfusion}</Text>
          <Text style={styles.clinicalText}>Blood loss: {hemorrhage.clinicalState.estimatedBloodLossMl.toFixed(0)} ml</Text>
          <Text style={styles.clinicalText}>Compensation: {hemorrhage.clinicalState.compensation}</Text>
          <Text style={styles.clinicalText}>Active effects: {hemorrhage.clinicalState.activeEffects.length}</Text>
        </View>
      )}
      {medications && (
        <View style={styles.clinicalBlock}>
          <Text style={styles.clinicalTitle}>Running medications: {medications.instances.filter(x => x.status === "ACTIVE").length}</Text>
          <Text style={styles.clinicalText}>Medication history: {medications.events.length}</Text>
          <Text style={styles.clinicalText}>Medication effects: {medications.effects.length}</Text>
        </View>
      )}
      {vitals && (
        <View style={styles.clinicalBlock}>
          <Text style={styles.clinicalTitle}>Current vitals · {vitals.quality}</Text>
          <Text style={styles.clinicalText}>HR {vitals.readings.heartRate.current} · BP {vitals.readings.systolicBp.current}/{vitals.readings.diastolicBp.current}</Text>
          <Text style={styles.clinicalText}>RR {vitals.readings.respiratoryRate.current} · SpO₂ {vitals.readings.spo2.current}% · EtCO₂ {vitals.readings.etco2.current}</Text>
          <Text style={styles.clinicalText}>MAP {vitals.derived.meanArterialPressure} · SI {vitals.derived.shockIndex} · PP {vitals.derived.pulsePressure}</Text>
          <Text style={styles.clinicalText}>Active contributors: {vitals.activeContributors.length}</Text>
        </View>
      )}
      <Text style={styles.caption}>
        Read-only resource runtime snapshot · t={snapshot.updatedAt}s
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%", maxWidth: 360, backgroundColor: "#f8fafc", borderColor: "#94a3b8",
    borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { color: "#0f172a", fontSize: 17, fontWeight: "bold" },
  badge: { color: "#6d28d9", backgroundColor: "#ede9fe", fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tableHeader: { flexDirection: "row", borderBottomColor: "#cbd5e1", borderBottomWidth: 1, paddingBottom: 6 },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomColor: "#e2e8f0", borderBottomWidth: 1, paddingVertical: 7 },
  resourceColumn: { flex: 1 },
  headerText: { color: "#64748b", fontSize: 11, fontWeight: "bold" },
  numberHeader: { color: "#64748b", fontSize: 11, fontWeight: "bold", textAlign: "right", width: 48 },
  resourceText: { color: "#1e293b", fontSize: 13, fontWeight: "600" },
  numberText: { color: "#334155", fontVariant: ["tabular-nums"], fontSize: 13, textAlign: "right", width: 48 },
  freeText: { color: "#067647", fontWeight: "bold" },
  inUseText: { color: "#b54708", fontWeight: "bold" },
  empty: { color: "#64748b", fontStyle: "italic", paddingVertical: 8 },
  caption: { color: "#64748b", fontSize: 11, marginTop: 9 },
  clinicalBlock: { borderTopColor: "#cbd5e1", borderTopWidth: 1, marginTop: 10, paddingTop: 9 },
  clinicalTitle: { color: "#7f1d1d", fontWeight: "bold", marginBottom: 3 },
  clinicalText: { color: "#334155", fontSize: 12, marginTop: 2 },
});
