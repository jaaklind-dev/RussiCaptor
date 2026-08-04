import type { ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ActivePackageBadge } from "./ActivePackageBadge";

const List = ({ title, values }: Readonly<{ title: string; values: readonly string[] }>) => <View style={styles.section}><Text style={styles.label}>{title}</Text>{values.length ? values.map(value => <Text key={value} style={styles.item}>• {value}</Text>) : <Text style={styles.item}>None</Text>}</View>;
const Hash = ({ title, value }: Readonly<{ title: string; value: string }>) => <View style={styles.section}><Text style={styles.label}>{title}</Text><Text selectable style={styles.hash}>{value}</Text></View>;

export function PackageDetail({ entry, active, onActivate }: Readonly<{ entry?: ExerciseCatalogEntry; active: boolean; onActivate: () => void }>) {
  if (!entry) return <View style={styles.empty}><Text style={styles.emptyText}>Select a package to inspect its canonical metadata.</Text></View>;
  const pkg = entry.exercisePackage;
  return <View testID="catalog-package-detail" style={styles.card}>
    <View style={styles.heading}><Text style={styles.title}>{pkg.metadata.name}</Text>{active && <ActivePackageBadge />}</View>
    <Text style={styles.description}>{pkg.metadata.description}</Text>
    <Text style={styles.meta}>{pkg.packageId} · package v{pkg.packageVersion} · definition v{pkg.definition.definitionVersion}</Text>
    <Text style={styles.meta}>{pkg.definition.profile} · {entry.compatibility}</Text>
    <Text style={styles.meta}>{pkg.metadata.author} · {pkg.metadata.organization}</Text>
    <Hash title="Package hash" value={pkg.packageHash} />
    <Hash title="Definition hash" value={pkg.manifest.definitionHash} />
    <List title="Objectives" values={pkg.definition.objectives.map(item => `${item.name}: ${item.description}`)} />
    <List title="Capabilities" values={pkg.definition.capabilities} />
    <List title="PatientProcesses" values={pkg.enabledPatientProcesses} />
    <List title="Analytics providers" values={pkg.enabledAnalyticsProviders} />
    <List title="Metric providers" values={pkg.enabledMetricProviders} />
    <List title="Tags" values={pkg.metadata.tags} />
    <Pressable testID="catalog-activate" disabled={active || entry.compatibility === "INCOMPATIBLE"} onPress={onActivate} style={[styles.button, (active || entry.compatibility === "INCOMPATIBLE") && styles.disabled]}><Text style={styles.buttonText}>{active ? "Active package" : entry.compatibility === "INCOMPATIBLE" ? "Incompatible package" : "Activate package"}</Text></Pressable>
    <Text style={styles.note}>Activation selects the package for future exercise setup. It does not start or modify the current exercise.</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 14, padding: 16, backgroundColor: "#fff" }, empty: { borderWidth: 1, borderStyle: "dashed", borderColor: "#c1c7d0", borderRadius: 14, padding: 24 }, emptyText: { color: "#6b778c", textAlign: "center" },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }, title: { flex: 1, fontSize: 22, fontWeight: "900", color: "#172b4d" }, description: { color: "#42526e", marginTop: 7, lineHeight: 20 }, meta: { color: "#6b778c", marginTop: 5 },
  section: { marginTop: 13 }, label: { color: "#172b4d", fontWeight: "900", marginBottom: 4 }, item: { color: "#42526e", marginTop: 2 }, hash: { color: "#005bbb", fontFamily: "monospace", fontSize: 11 },
  button: { backgroundColor: "#005bbb", borderRadius: 10, padding: 13, alignItems: "center", marginTop: 18 }, disabled: { backgroundColor: "#8993a4" }, buttonText: { color: "#fff", fontWeight: "900" }, note: { color: "#6b778c", fontSize: 11, marginTop: 8, textAlign: "center" },
});
