import type { DebriefReport } from "@/services/debrief/DebriefModel";
import { StyleSheet, Text, View } from "react-native";
import { exerciseLifecycleLabel, processStatusLabel } from "@/localization/et";

export function DebriefSummary({ report }: { report: DebriefReport }) {
  const legacyClock = report.clockMigrationStatus !== "CANONICAL";
  const values = [
    ["Olek", exerciseLifecycleLabel(report.exerciseState)], ["Hetktõmmise kestus", `T+${report.simulationDurationSec}s`],
    ["Patsiendid", `${report.patientCount}`], ["Lõpetatud", `${report.completedPatients}`],
    ["Ajajoon", `${report.timelineLength}`], ["Käsud", `${report.commandCount}`], ["Audit", `${report.auditCount}`],
  ];
  return <View style={styles.card}><View style={styles.heading}><Text style={styles.title}>Õppuse kokkuvõte</Text>{legacyClock && <Text style={styles.legacy}>Pärandõppuse kell</Text>}</View><View style={styles.grid}>
    {values.map(([label, value]) => <View key={label} style={styles.item}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>)}
  </View>{report.protocolProvenance && <View style={styles.protocol}><Text style={styles.label}>Protokoll</Text><Text style={styles.value}>{report.protocolProvenance.name} · {report.protocolProvenance.protocolId}@{report.protocolProvenance.version}</Text><Text style={styles.source}>{processStatusLabel(report.protocolProvenance.status)} · {report.protocolProvenance.authority}</Text><Text style={styles.hash}>{report.protocolProvenance.protocolHash}</Text></View>}<Text style={styles.source}>Kestus pärineb kanoonilisest õppuse hetktõmmisest; debriif seda ei arvuta ega normaliseeri.</Text><Text style={styles.hash}>Taasesituse allikas · {report.generatedFromReplayHash.slice(0, 16)}…</Text></View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#f4f6f8", borderRadius: 12, padding: 14, marginBottom: 12 }, heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }, title: { fontSize: 18, fontWeight: "900", color: "#172b4d" }, legacy: { color: "#7a5700", backgroundColor: "#fff3cd", borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, fontWeight: "800", fontSize: 11 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, item: { minWidth: 92, flexGrow: 1, backgroundColor: "#fff", borderRadius: 8, padding: 9 }, protocol: { marginTop: 10, padding: 10, backgroundColor: "#e9f2ff", borderRadius: 8 }, label: { fontSize: 11, color: "#6b778c", fontWeight: "700" }, value: { color: "#172b4d", fontWeight: "900", marginTop: 2 }, source: { color: "#42526e", fontSize: 11, marginTop: 10 }, hash: { color: "#6b778c", fontSize: 11, marginTop: 6, fontFamily: "monospace" } });
