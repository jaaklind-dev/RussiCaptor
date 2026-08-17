import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { StyleSheet, Text, View } from "react-native";
import { exerciseProfileLabel, processStatusLabel } from "@/localization/et";

const label = (value: string) => value.replaceAll("_", " ");
export function ExerciseInformationCard({ definition }: { definition: ExerciseDefinition }) {
  return <View style={styles.card} testID="exercise-information-card">
    <View style={styles.heading}><Text style={styles.title}>Õppuse teave</Text><Text style={styles.version}>v{definition.definitionVersion}</Text></View>
    <Text style={styles.name}>{definition.name}</Text><Text style={styles.description}>{definition.description}</Text>
    <Row title="Profiil" values={[exerciseProfileLabel(definition.profile)]} />
    <Row title="Eesmärgid" values={definition.objectives.map(item => item.name)} />
    <Row title="Võimekused" values={definition.capabilities.map(label)} />
    <Row title="Lubatud patsiendiprotsessid" values={definition.enabledPatientProcesses.map(label)} />
    <Row title="Analüütika pakkujad" values={definition.enabledAnalyticsProviders} />
    <Row title="Mõõdikupakkujad" values={definition.enabledMetricProviders} />
    <Row title="Kliinilised moodulid" values={(definition.clinicalModuleComposition?.modules ?? []).map(module => `${module.moduleId}@${module.version}`)} />
    {definition.protocolProvenance && <>
      <Row title="Protokoll" values={[`${definition.protocolProvenance.name} · ${definition.protocolProvenance.protocolId}@${definition.protocolProvenance.version}`]} />
      <Row title="Protokolli olek" values={[processStatusLabel(definition.protocolProvenance.status)]} />
      <Row title="Protokolli autoriteet" values={[definition.protocolProvenance.authority]} />
      <Row title="Protokolli hash" values={[definition.protocolProvenance.protocolHash]} />
      <Row title="Nõutavad võimekused" values={definition.protocolProvenance.requiredCapabilities} />
    </>}
  </View>;
}
function Row({ title, values }: { title: string; values: readonly string[] }) { return <View style={styles.row}><Text style={styles.label}>{title}</Text><Text style={styles.value}>{values.join(" · ") || "Puudub"}</Text></View>; }
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#dfe1e6", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 }, heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, title: { fontSize: 18, fontWeight: "900", color: "#172b4d" }, version: { color: "#005bbb", fontWeight: "900", backgroundColor: "#e9f2ff", borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4 }, name: { color: "#172b4d", fontWeight: "800", marginTop: 9 }, description: { color: "#5e6c84", marginTop: 3, marginBottom: 5 }, row: { borderTopWidth: 1, borderTopColor: "#ebecf0", paddingTop: 8, marginTop: 8 }, label: { color: "#6b778c", fontSize: 11, fontWeight: "800", textTransform: "uppercase" }, value: { color: "#172b4d", marginTop: 3, lineHeight: 19 } });
