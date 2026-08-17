import type { ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { StyleSheet, Text, View } from "react-native";
import { PackageCard } from "./PackageCard";

export function PackageList({ entries, activeKey, selectedKey, onSelect }: Readonly<{ entries: readonly ExerciseCatalogEntry[]; activeKey?: string; selectedKey?: string; onSelect: (entry: ExerciseCatalogEntry) => void }>) {
  if (!entries.length) return <Text style={styles.empty}>Valitud filtritele vastavaid pakette ei ole.</Text>;
  return <View>{entries.map(entry => { const pkg = entry.exercisePackage; const key = `${pkg.packageId}@${pkg.packageVersion}`; return <PackageCard key={key} entry={entry} active={activeKey === key} selected={selectedKey === key} onPress={() => onSelect(entry)} />; })}</View>;
}

const styles = StyleSheet.create({ empty: { color: "#6b778c", textAlign: "center", padding: 24 } });
