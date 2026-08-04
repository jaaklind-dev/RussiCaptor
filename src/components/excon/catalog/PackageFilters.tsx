import type { ExercisePackageCompatibility } from "@/models/exercise/ExercisePackageManifest";
import type { ExerciseProfile } from "@/models/exercise/ExerciseProfile";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

function SelectRow<T extends string>({ label, values, value, onChange }: Readonly<{ label: string; values: readonly T[]; value?: T; onChange: (value?: T) => void }>) {
  return <View style={styles.group}><Text style={styles.label}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}><Text onPress={() => onChange(undefined)} style={[styles.option, !value && styles.active]}>All</Text>{values.map(item => <Text key={item} onPress={() => onChange(item)} style={[styles.option, value === item && styles.active]}>{item.replaceAll("_", " ")}</Text>)}</ScrollView></View>;
}

export function PackageFilters({ search, profile, compatibility, tag, profiles, tags, onSearch, onProfile, onCompatibility, onTag }: Readonly<{ search: string; profile?: ExerciseProfile; compatibility?: ExercisePackageCompatibility; tag?: string; profiles: readonly ExerciseProfile[]; tags: readonly string[]; onSearch: (value: string) => void; onProfile: (value?: ExerciseProfile) => void; onCompatibility: (value?: ExercisePackageCompatibility) => void; onTag: (value?: string) => void }>) {
  return <View style={styles.container}>
    <TextInput testID="catalog-search" value={search} onChangeText={onSearch} placeholder="Search packages" style={styles.input} autoCapitalize="none" />
    <SelectRow label="Profile" values={profiles} value={profile} onChange={onProfile} />
    <SelectRow label="Compatibility" values={["SUPPORTED", "LEGACY", "INCOMPATIBLE"]} value={compatibility} onChange={onCompatibility} />
    <SelectRow label="Tag" values={tags} value={tag} onChange={onTag} />
  </View>;
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 }, input: { borderWidth: 1, borderColor: "#c1c7d0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, backgroundColor: "#fff" },
  group: { marginTop: 7 }, label: { color: "#42526e", fontWeight: "800", fontSize: 12, marginBottom: 5 }, options: { gap: 6 },
  option: { borderWidth: 1, borderColor: "#c1c7d0", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, color: "#42526e", fontSize: 12, overflow: "hidden" },
  active: { backgroundColor: "#172b4d", borderColor: "#172b4d", color: "#fff" },
});
