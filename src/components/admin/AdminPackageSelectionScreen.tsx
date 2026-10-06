import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { compatibilityLabel, exercisePackageNameLabel } from "@/localization/et";
import { adminPackageCreateRoute } from "@/services/admin/AdminPackageSelectionService";
import { exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";

export default function AdminPackageSelectionScreen() {
  const [search, setSearch] = useState("");
  const packages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("et");
    return exercisePackageRegistry.packages
      .map(pkg => Object.freeze({ pkg, compatibility: exercisePackageValidator.compatibility(pkg) }))
      .filter(entry => entry.compatibility !== "INCOMPATIBLE")
      .filter(({ pkg }) => !query || [pkg.metadata.name, pkg.metadata.description, pkg.packageVersion]
        .some(value => value.toLocaleLowerCase("et").includes(query)));
  }, [search]);

  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} testID="admin-package-back"><Text style={styles.back}>‹ Õppused</Text></Pressable>
    <Text style={styles.title}>Vali õppusepakett</Text>
    <Text style={styles.subtitle}>Valitud paketi põhjal valmistatakse ette üks uus õppus.</Text>
    <TextInput
      accessibilityLabel="Otsi õppusepaketti"
      autoCapitalize="none"
      onChangeText={setSearch}
      placeholder="Otsi nime või kirjelduse järgi"
      style={styles.search}
      value={search}
    />
    <Text style={styles.count}>{packages.length} paketti</Text>
    {packages.length === 0 && <Text style={styles.empty}>Sobivat õppusepaketti ei leitud.</Text>}
    {packages.map(({ pkg, compatibility }) => <Pressable
      accessibilityLabel={`Vali ${exercisePackageNameLabel(pkg.metadata.name)}, versioon ${pkg.packageVersion}`}
      accessibilityRole="button"
      key={`${pkg.packageId}@${pkg.packageVersion}`}
      onPress={() => router.push(adminPackageCreateRoute({ packageId: pkg.packageId, packageVersion: pkg.packageVersion }))}
      style={styles.card}
      testID={`admin-package-${pkg.packageId}-${pkg.packageVersion}`}
    >
      <View style={styles.heading}>
        <Text style={styles.name}>{exercisePackageNameLabel(pkg.metadata.name)}</Text>
        <Text style={styles.version}>Versioon {pkg.packageVersion}</Text>
      </View>
      <Text style={styles.description}>{pkg.metadata.description}</Text>
      <Text style={styles.compatibility}>{compatibilityLabel(compatibility)}</Text>
      <Text style={styles.action}>Vali pakett</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" onPress={() => router.replace("/admin/exercises")} style={styles.cancel} testID="admin-package-cancel">
      <Text style={styles.cancelText}>Loobu</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#F6F8FB", padding: 20, paddingBottom: 40, gap: 12 },
  back: { color: "#005BBB", fontWeight: "700" },
  title: { color: "#101828", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#475467", lineHeight: 20 },
  search: { backgroundColor: "#fff", borderColor: "#98A2B3", borderRadius: 8, borderWidth: 1, color: "#101828", paddingHorizontal: 12, paddingVertical: 10 },
  count: { color: "#667085", fontWeight: "700" },
  empty: { color: "#667085", paddingVertical: 24, textAlign: "center" },
  card: { backgroundColor: "#fff", borderColor: "#D0D5DD", borderRadius: 14, borderWidth: 1, gap: 7, padding: 15 },
  heading: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  name: { color: "#101828", flex: 1, fontSize: 18, fontWeight: "900" },
  version: { color: "#475467", fontWeight: "700" },
  description: { color: "#475467", lineHeight: 19 },
  compatibility: { color: "#067647", fontSize: 12, fontWeight: "800" },
  action: { color: "#005BBB", fontWeight: "900", marginTop: 3 },
  cancel: { alignItems: "center", borderColor: "#98A2B3", borderRadius: 9, borderWidth: 1, padding: 12 },
  cancelText: { color: "#344054", fontWeight: "800" },
});
