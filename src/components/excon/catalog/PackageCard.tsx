import type { ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ActivePackageBadge } from "./ActivePackageBadge";

export function PackageCard({ entry, active, selected, onPress }: Readonly<{ entry: ExerciseCatalogEntry; active: boolean; selected: boolean; onPress: () => void }>) {
  const pkg = entry.exercisePackage;
  return (
    <Pressable testID={`catalog-package-${pkg.packageId}-${pkg.packageVersion}`} onPress={onPress} style={[styles.card, selected && styles.selected]}>
      <View style={styles.heading}><Text style={styles.name}>{pkg.metadata.name}</Text>{active && <ActivePackageBadge />}</View>
      <Text style={styles.meta}>{pkg.definition.profile} · v{pkg.packageVersion}</Text>
      <Text style={[styles.compatibility, entry.compatibility === "INCOMPATIBLE" && styles.incompatible]}>{entry.compatibility}</Text>
      <Text style={styles.byline}>{pkg.metadata.author} · {pkg.metadata.organization}</Text>
      <Text style={styles.tags}>{pkg.metadata.tags.join(" · ")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 12, padding: 13, marginBottom: 9, backgroundColor: "#fff" },
  selected: { borderColor: "#005bbb", backgroundColor: "#f0f7ff" },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, color: "#172b4d", fontWeight: "900", fontSize: 16 },
  meta: { color: "#42526e", marginTop: 5, fontWeight: "700" },
  compatibility: { color: "#006644", fontWeight: "800", fontSize: 11, marginTop: 6 },
  incompatible: { color: "#bf2600" },
  byline: { color: "#6b778c", marginTop: 6, fontSize: 12 },
  tags: { color: "#005bbb", marginTop: 5, fontSize: 12 },
});
