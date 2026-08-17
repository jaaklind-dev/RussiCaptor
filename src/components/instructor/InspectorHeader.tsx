import type { InspectorHeaderModel } from "@/models/InstructorPatientInspector";
import { StyleSheet, Text, View } from "react-native";
import { patientStatusLabel } from "@/localization/et";

const statusColor = {
  Stable: "#1b5e20", "Requires attention": "#7a5700", Critical: "#9a4300",
  "Life threatening": "#8e0000", Completed: "#4b4b4b",
} as const;

export function InspectorHeader({ header }: { header: InspectorHeaderModel }) {
  return (
    <View style={styles.header}>
      <View style={styles.identity}>
        <Text style={styles.patientId}>{header.patientId}</Text>
        <Text style={styles.name}>{header.name}</Text>
        <Text style={styles.nationalId}>Isikukood: {header.nationalId || "—"}</Text>
      </View>
      <View style={styles.metadata}>
        <Text style={[styles.status, { color: statusColor[header.status] }]}>{patientStatusLabel(header.status)}</Text>
        <Text style={styles.line}>{header.location} · {header.triage}</Text>
        <Text style={styles.line}>Juhtumikorraldaja: {header.caseManagerName ?? "—"}</Text>
        <Text style={styles.line}>Simulatsioon: {header.simulationTimeSec === undefined ? "—" : `T+${header.simulationTimeSec}s`}</Text>
        <Text style={styles.line}>Hetktõmmis: {header.lastSnapshotTimestamp ?? "Canonical runtime on ootel"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 18, padding: 18, backgroundColor: "#f2f4f7", borderRadius: 16 },
  identity: { flex: 1, minWidth: 220 }, metadata: { flex: 1, minWidth: 250, alignItems: "flex-end" },
  patientId: { fontSize: 28, fontWeight: "900", color: "#172b4d" }, name: { fontSize: 20, fontWeight: "700", color: "#172b4d", marginTop: 2 },
  nationalId: { marginTop: 5, color: "#6b778c" }, status: { fontSize: 18, fontWeight: "900" },
  line: { color: "#42526e", marginTop: 3, textAlign: "right" },
});
