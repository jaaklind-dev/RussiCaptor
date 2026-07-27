import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getResourceRuntimeDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import { summarizeResources } from "@/services/runtime/selectors/ResourceSelectors";

export default function ResourceMonitorCard() {
  useSyncExternalStore(
    subscribeToResourceRuntimeDebug,
    getResourceRuntimeDebugVersion,
    getResourceRuntimeDebugVersion
  );
  const snapshot = getResourceRuntimeDebugSnapshot();
  const rows = summarizeResources(snapshot.resources);

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
      <Text style={styles.caption}>
        Read-only ResourcePool snapshot · t={snapshot.updatedAt}s
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
});
