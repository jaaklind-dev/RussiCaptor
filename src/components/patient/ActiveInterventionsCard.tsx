import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getPatientResourceDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";

function interventionLabel(name: string, parameters: Record<string, string | number | boolean | null>): string {
  const flow = parameters.flowRateLMin;
  return flow !== undefined ? `${name} ${flow} L/min` : name;
}

export default function ActiveInterventionsCard({ patientId }: { patientId: string }) {
  useSyncExternalStore(
    subscribeToResourceRuntimeDebug,
    getResourceRuntimeDebugVersion,
    getResourceRuntimeDebugVersion
  );
  const active = (getPatientResourceDebugSnapshot(patientId).clinicalInterventions ?? [])
    .filter(item => item.status === "RUNNING");

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Aktiivsed sekkumised</Text>
      {active.length === 0 ? (
        <Text style={styles.empty}>Aktiivseid sekkumisi ei ole</Text>
      ) : active.map(item => (
        <View key={item.instanceId} style={styles.row}>
          <Text style={styles.check}>✓</Text>
          <Text style={styles.label}>{interventionLabel(item.definitionName, item.parameters)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#ffffff", borderColor: "#dbe4ee", borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 14 },
  title: { color: "#0f172a", fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  check: { color: "#15803d", fontSize: 16, fontWeight: "bold", marginRight: 9 },
  label: { color: "#1e293b", fontSize: 15 },
  empty: { color: "#64748b", fontStyle: "italic" },
});
