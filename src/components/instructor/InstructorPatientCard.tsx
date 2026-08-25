import type { InstructorPatientCardModel } from "@/models/InstructorDashboard";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { patientStatusLabel } from "@/localization/et";

const statusColors = {
  Stable: { border: "#2e7d32", background: "#e8f5e9", text: "#1b5e20" },
  "Requires attention": { border: "#d4a017", background: "#fff8dc", text: "#7a5700" },
  Critical: { border: "#ef6c00", background: "#fff3e0", text: "#9a4300" },
  "Life threatening": { border: "#c62828", background: "#ffebee", text: "#8e0000" },
  Completed: { border: "#7a7a7a", background: "#eeeeee", text: "#4b4b4b" },
} as const;

const value = (input: number | string | undefined, suffix = "") => input === undefined ? "—" : `${input}${suffix}`;

function InstructorPatientCardComponent({ patient, onPress }: {
  patient: InstructorPatientCardModel;
  onPress: (patientId: string) => void;
}) {
  const colors = statusColors[patient.status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ava patsient ${patient.patientId}`}
      onPress={() => onPress(patient.patientId)}
      style={({ pressed }) => [styles.card, { borderColor: colors.border, backgroundColor: colors.background }, pressed && styles.pressed]}
    >
      <View style={styles.heading}>
        <Text style={styles.patientId}>{patient.patientId}</Text>
        <Text style={[styles.status, { color: colors.text }]}>{patientStatusLabel(patient.status)}</Text>
      </View>
      <Text numberOfLines={1} style={styles.name}>{patient.name}</Text>
      <Text style={styles.meta}>{patient.location} · {patient.triage}</Text>
      <Text numberOfLines={1} style={styles.owner}>CM: {patient.caseManagerName ?? "—"}</Text>
      <View style={styles.vitals}>
        <Text style={styles.vital}>AVPU {value(patient.avpu)}</Text>
        <Text style={styles.vital}>SpO₂ {patient.pulseOxSignalQuality === "NO_SIGNAL" ? "signaal puudub" : patient.pulseOxSignalQuality === "POOR" ? "signaal ebausaldusväärne" : value(patient.spo2, "%")}</Text>
        <Text style={styles.vital}>RR {value(patient.respiratoryRate)}</Text>
        <Text style={styles.vital}>HR {value(patient.heartRate)}</Text>
        <Text style={styles.vital}>SBP {value(patient.systolicBp)}</Text>
      </View>
      <Text style={styles.time}>Simulatsioon: {value(patient.simulationTimeSec, "s")}</Text>
      <Text style={styles.updated}>Uuendatud: {patient.lastUpdate ?? "—"}</Text>
      {!patient.hasCanonicalRuntime && <Text style={styles.missing}>Canonical runtime on ootel</Text>}
    </Pressable>
  );
}

export const InstructorPatientCard = memo(InstructorPatientCardComponent);

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 250, maxWidth: 390, borderWidth: 2, borderRadius: 14, padding: 14, margin: 6 },
  pressed: { opacity: 0.75 }, heading: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  patientId: { fontSize: 20, fontWeight: "800", color: "#172b4d" },
  status: { fontWeight: "800", fontSize: 13 }, name: { marginTop: 3, fontSize: 16, fontWeight: "700", color: "#172b4d" },
  meta: { marginTop: 5, color: "#42526e", fontWeight: "600" }, owner: { marginTop: 3, color: "#005bbb" },
  vitals: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  vital: { fontVariant: ["tabular-nums"], color: "#172b4d", fontWeight: "700" },
  time: { marginTop: 11, fontSize: 12, color: "#42526e" }, updated: { marginTop: 2, fontSize: 12, color: "#6b778c" },
  missing: { marginTop: 7, color: "#7a5700", fontSize: 11, fontWeight: "700" },
});
