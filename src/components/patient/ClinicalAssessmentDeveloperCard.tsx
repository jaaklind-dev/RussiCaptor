import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getAssessmentDebugSnapshot,
  getAssessmentDebugVersion,
  subscribeToAssessmentDebug,
} from "@/services/AssessmentRuntimeDebugService";

export default function ClinicalAssessmentDeveloperCard() {
  useSyncExternalStore(subscribeToAssessmentDebug, getAssessmentDebugVersion, getAssessmentDebugVersion);
  const snapshot = getAssessmentDebugSnapshot();
  const results = snapshot?.results ?? [];
  const count = (status: string) => results.filter(item => item.status === status).length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Kliiniline hindamine</Text><Text style={styles.badge}>DEV</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.pass}>PASS {count("PASS")}</Text>
        <Text style={styles.warning}>WARNING {count("WARNING")}</Text>
        <Text style={styles.fail}>FAIL {count("FAIL")}</Text>
      </View>
      <Text style={styles.line}>Rules evaluated: {results.length}</Text>
      <Text style={styles.line}>Completed interventions: {snapshot?.debrief.completedInterventions.length ?? 0}</Text>
      {!snapshot && <Text style={styles.empty}>Assessment snapshot pole veel saadaval.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#f8fafc", borderColor: "#94a3b8", borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#0f172a", fontSize: 20, fontWeight: "bold" },
  badge: { color: "#6d28d9", backgroundColor: "#ede9fe", fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  row: { flexDirection: "row", gap: 12, marginVertical: 12 },
  pass: { color: "#15803d", fontWeight: "bold" },
  warning: { color: "#b45309", fontWeight: "bold" },
  fail: { color: "#b42318", fontWeight: "bold" },
  line: { color: "#334155", marginTop: 4 },
  empty: { color: "#64748b", fontStyle: "italic", marginTop: 8 },
});
