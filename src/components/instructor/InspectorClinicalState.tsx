import type { InspectorClinicalStateModel } from "@/models/InstructorPatientInspector";
import { StyleSheet, Text, View } from "react-native";

const show = (value: number | string | undefined, suffix = "") => value === undefined ? "—" : `${value}${suffix}`;

export function InspectorClinicalState({ state }: { state: InspectorClinicalStateModel }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Praegune kliiniline seisund</Text>
      {!state.hasCanonicalRuntime ? <Text style={styles.pending}>Canonical runtime on ootel</Text> : (
        <View style={styles.grid}>
          <Text style={styles.vital}>HR {show(state.heartRate)}</Text>
          <Text style={styles.vital}>RR {show(state.respiratoryRate)}</Text>
          <Text style={styles.vital}>SpO₂ {show(state.spo2, "%")}</Text>
          <Text style={styles.vital}>BP {show(state.systolicBp)}/{show(state.diastolicBp)}</Text>
          <Text style={styles.vital}>MAP {show(state.map)}</Text>
          <Text style={styles.vital}>Temp {show(state.temperature, "°C")}</Text>
          <Text style={styles.vital}>EtCO₂ {show(state.etco2)}</Text>
          <Text style={styles.vital}>AVPU {show(state.avpu)}</Text>
          <Text style={styles.vital}>GCS {show(state.gcs)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d0d5dd", borderRadius: 14, padding: 15 },
  title: { fontSize: 18, fontWeight: "800", color: "#172b4d", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  vital: { minWidth: 88, color: "#172b4d", fontWeight: "800", fontVariant: ["tabular-nums"] },
  pending: { color: "#7a5700", fontWeight: "700" },
});
