import type { DebriefReport } from "@/services/debrief/DebriefModel";
import { StyleSheet, Text, View } from "react-native";

export function DebriefSummary({ report }: { report: DebriefReport }) {
  const values = [
    ["State", report.exerciseState], ["Snapshot duration", `T+${report.simulationDurationSec}s`],
    ["Patients", `${report.patientCount}`], ["Completed", `${report.completedPatients}`],
    ["Timeline", `${report.timelineLength}`], ["Commands", `${report.commandCount}`], ["Audit", `${report.auditCount}`],
  ];
  return <View style={styles.card}><Text style={styles.title}>Exercise Summary</Text><View style={styles.grid}>
    {values.map(([label, value]) => <View key={label} style={styles.item}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>)}
  </View><Text style={styles.source}>Duration is the canonical Exercise Snapshot value; Debrief does not calculate or normalize it.</Text><Text style={styles.hash}>Replay source · {report.generatedFromReplayHash.slice(0, 16)}…</Text></View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#f4f6f8", borderRadius: 12, padding: 14, marginBottom: 12 }, title: { fontSize: 18, fontWeight: "900", color: "#172b4d", marginBottom: 10 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, item: { minWidth: 92, flexGrow: 1, backgroundColor: "#fff", borderRadius: 8, padding: 9 }, label: { fontSize: 11, color: "#6b778c", fontWeight: "700" }, value: { color: "#172b4d", fontWeight: "900", marginTop: 2 }, source: { color: "#42526e", fontSize: 11, marginTop: 10 }, hash: { color: "#6b778c", fontSize: 11, marginTop: 6, fontFamily: "monospace" } });
