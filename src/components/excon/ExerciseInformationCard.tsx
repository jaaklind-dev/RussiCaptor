import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { StyleSheet, Text, View } from "react-native";

const label = (value: string) => value.replaceAll("_", " ");
export function ExerciseInformationCard({ definition }: { definition: ExerciseDefinition }) {
  return <View style={styles.card} testID="exercise-information-card">
    <View style={styles.heading}><Text style={styles.title}>Exercise Information</Text><Text style={styles.version}>v{definition.definitionVersion}</Text></View>
    <Text style={styles.name}>{definition.name}</Text><Text style={styles.description}>{definition.description}</Text>
    <Row title="Profile" values={[label(definition.profile)]} />
    <Row title="Objectives" values={definition.objectives.map(item => item.name)} />
    <Row title="Capabilities" values={definition.capabilities.map(label)} />
    <Row title="Enabled PatientProcesses" values={definition.enabledPatientProcesses.map(label)} />
    <Row title="Analytics providers" values={definition.enabledAnalyticsProviders} />
    <Row title="Metric providers" values={definition.enabledMetricProviders} />
    <Row title="Clinical Modules" values={(definition.clinicalModuleComposition?.modules ?? []).map(module => `${module.moduleId}@${module.version}`)} />
  </View>;
}
function Row({ title, values }: { title: string; values: readonly string[] }) { return <View style={styles.row}><Text style={styles.label}>{title}</Text><Text style={styles.value}>{values.join(" · ") || "None"}</Text></View>; }
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#dfe1e6", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 }, heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, title: { fontSize: 18, fontWeight: "900", color: "#172b4d" }, version: { color: "#005bbb", fontWeight: "900", backgroundColor: "#e9f2ff", borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4 }, name: { color: "#172b4d", fontWeight: "800", marginTop: 9 }, description: { color: "#5e6c84", marginTop: 3, marginBottom: 5 }, row: { borderTopWidth: 1, borderTopColor: "#ebecf0", paddingTop: 8, marginTop: 8 }, label: { color: "#6b778c", fontSize: 11, fontWeight: "800", textTransform: "uppercase" }, value: { color: "#172b4d", marginTop: 3, lineHeight: 19 } });
