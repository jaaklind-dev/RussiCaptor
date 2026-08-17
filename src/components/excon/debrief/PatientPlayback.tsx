import type { PatientPlaybackView } from "@/services/debrief/DebriefModel";
import { StyleSheet, Text, View } from "react-native";
import { patientOutcomeLabel } from "@/localization/dataDrivenEt";
import { processStatusLabel } from "@/localization/et";

export function PatientPlayback({ view }: { view?: PatientPlaybackView }) {
  if (!view) return <View style={styles.card}><Text style={styles.empty}>Vali patsient, kelle sündmusi taasesitada.</Text></View>;
  return <View style={styles.card}>
    <Text style={styles.title}>{view.patient.patientId} · {view.patient.name}</Text>
    <Text style={styles.meta}>{view.patient.initialLocation} → {view.patient.finalLocation} · {patientOutcomeLabel(view.patient.outcome)}</Text>
    <Text style={styles.heading}>Hetkel T+{view.simulationTimeSec}s</Text>
    <Text style={styles.meta}>{view.events.length} patsiendisündmust · {view.processes.length} protsessi</Text>
    {view.processes.map(process => <Text key={`${process.processId}:${process.moduleId}`} style={styles.process}>• {process.processId} · {processStatusLabel(process.status)}</Text>)}
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 12, padding: 14, marginBottom: 12 }, title: { fontWeight: "900", fontSize: 17, color: "#172b4d" }, heading: { marginTop: 10, fontWeight: "800", color: "#172b4d" }, meta: { color: "#5e6c84", marginTop: 3 }, process: { color: "#42526e", marginTop: 4 }, empty: { color: "#6b778c" } });
