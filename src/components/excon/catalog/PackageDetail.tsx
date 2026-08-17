import type { ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ActivePackageBadge } from "./ActivePackageBadge";
import { compatibilityLabel, exercisePackageNameLabel, exercisePackageTagLabel, exerciseProfileLabel } from "@/localization/et";

const List = ({ title, values }: Readonly<{ title: string; values: readonly string[] }>) => <View style={styles.section}><Text style={styles.label}>{title}</Text>{values.length ? values.map(value => <Text key={value} style={styles.item}>• {value}</Text>) : <Text style={styles.item}>Puudub</Text>}</View>;
const Hash = ({ title, value }: Readonly<{ title: string; value: string }>) => <View style={styles.section}><Text style={styles.label}>{title}</Text><Text selectable style={styles.hash}>{value}</Text></View>;

export function PackageDetail({ entry, active, onActivate }: Readonly<{ entry?: ExerciseCatalogEntry; active: boolean; onActivate: () => void }>) {
  if (!entry) return <View style={styles.empty}><Text style={styles.emptyText}>Vali pakett, et vaadata selle canonical metaandmeid.</Text></View>;
  const pkg = entry.exercisePackage;
  return <View testID="catalog-package-detail" style={styles.card}>
    <View style={styles.heading}><Text style={styles.title}>{exercisePackageNameLabel(pkg.metadata.name)}</Text>{active && <ActivePackageBadge />}</View>
    <Text style={styles.description}>{pkg.metadata.description}</Text>
    <Text style={styles.meta}>{pkg.packageId} · pakett v{pkg.packageVersion} · definitsioon v{pkg.definition.definitionVersion}</Text>
    <Text style={styles.meta}>{exerciseProfileLabel(pkg.definition.profile)} · {compatibilityLabel(entry.compatibility)}</Text>
    <Text style={styles.meta}>{pkg.metadata.author} · {pkg.metadata.organization}</Text>
    <Hash title="Paketi hash" value={pkg.packageHash} />
    <Hash title="Definitsiooni hash" value={pkg.manifest.definitionHash} />
    <List title="Eesmärgid" values={pkg.definition.objectives.map(item => `${item.name}: ${item.description}`)} />
    <List title="Võimekused" values={pkg.definition.capabilities} />
    <List title="Patsiendiprotsessid" values={pkg.enabledPatientProcesses} />
    <List title="Analüütikapakkujad" values={pkg.enabledAnalyticsProviders} />
    <List title="Mõõdikupakkujad" values={pkg.enabledMetricProviders} />
    <List title="Nõutavad kliinilised moodulid" values={(pkg.requiredClinicalModules ?? []).map(module => `${module.moduleId}@${module.version}`)} />
    <List title="Komponeeritud kliinilised moodulid" values={(pkg.definition.clinicalModuleComposition?.modules ?? []).map(module => `${module.moduleId}@${module.version} · järjekord ${module.compositionOrder}`)} />
    {pkg.definition.protocolProvenance && <>
      <List title="Protocol" values={[`${pkg.definition.protocolProvenance.name} · ${pkg.definition.protocolProvenance.protocolId}@${pkg.definition.protocolProvenance.version} · ${pkg.definition.protocolProvenance.status}`]} />
      <Hash title="Protokolli hash" value={pkg.definition.protocolProvenance.protocolHash} />
      <List title="Protokolli autoriteet" values={[pkg.definition.protocolProvenance.authority, pkg.definition.protocolProvenance.publicationReference ?? "Publikatsiooniviide puudub"]} />
      <List title="Nõutavad protokollivõimekused" values={pkg.definition.protocolProvenance.requiredCapabilities} />
    </>}
    <List title="Märksõnad" values={pkg.metadata.tags.map(exercisePackageTagLabel)} />
    <Pressable testID="catalog-activate" disabled={active || entry.compatibility === "INCOMPATIBLE"} onPress={onActivate} style={[styles.button, (active || entry.compatibility === "INCOMPATIBLE") && styles.disabled]}><Text style={styles.buttonText}>{active ? "Aktiivne pakett" : entry.compatibility === "INCOMPATIBLE" ? "Ühildumatu pakett" : "Aktiveeri pakett"}</Text></Pressable>
    <Text style={styles.note}>Aktiveerimine valib paketi tulevase õppuse ettevalmistamiseks. See ei käivita ega muuda praegust õppust.</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 14, padding: 16, backgroundColor: "#fff" }, empty: { borderWidth: 1, borderStyle: "dashed", borderColor: "#c1c7d0", borderRadius: 14, padding: 24 }, emptyText: { color: "#6b778c", textAlign: "center" },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }, title: { flex: 1, fontSize: 22, fontWeight: "900", color: "#172b4d" }, description: { color: "#42526e", marginTop: 7, lineHeight: 20 }, meta: { color: "#6b778c", marginTop: 5 },
  section: { marginTop: 13 }, label: { color: "#172b4d", fontWeight: "900", marginBottom: 4 }, item: { color: "#42526e", marginTop: 2 }, hash: { color: "#005bbb", fontFamily: "monospace", fontSize: 11 },
  button: { backgroundColor: "#005bbb", borderRadius: 10, padding: 13, alignItems: "center", marginTop: 18 }, disabled: { backgroundColor: "#8993a4" }, buttonText: { color: "#fff", fontWeight: "900" }, note: { color: "#6b778c", fontSize: 11, marginTop: 8, textAlign: "center" },
});
