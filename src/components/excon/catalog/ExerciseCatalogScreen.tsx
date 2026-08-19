import type { ExercisePackageCompatibility } from "@/models/exercise/ExercisePackageManifest";
import type { ExerciseProfile } from "@/models/exercise/ExerciseProfile";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import { filterExerciseCatalog, listExerciseCatalogTags, type ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { router } from "expo-router";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { PackageDetail } from "./PackageDetail";
import { PackageFilters } from "./PackageFilters";
import { PackageList } from "./PackageList";

const keyOf = (entry?: ExerciseCatalogEntry) => entry ? `${entry.exercisePackage.packageId}@${entry.exercisePackage.packageVersion}` : undefined;

export function resolveCatalogSelection(entries: readonly ExerciseCatalogEntry[], selectedKey?: string): ExerciseCatalogEntry | undefined {
  return entries.find(entry => keyOf(entry) === selectedKey) ?? entries[0];
}

export function activateCatalogEntry(entry: ExerciseCatalogEntry | undefined, service: Pick<typeof activeExercisePackageService, "activateWithResult">) {
  if (!entry) return Object.freeze({ ok: false as const, code: "PACKAGE_NOT_FOUND" as const, message: "Vali aktiveeritav õppusepakett." });
  return service.activateWithResult(entry.exercisePackage.packageId, entry.exercisePackage.packageVersion);
}

export function projectCatalogActiveKey(serviceActiveKey: string | undefined, commandActiveKey: string | undefined): string | undefined {
  return commandActiveKey ?? serviceActiveKey;
}

export function ExerciseCatalogScreen() {
  useSyncExternalStore(listener => activeExercisePackageService.subscribe(listener), () => activeExercisePackageService.getVersion(), () => activeExercisePackageService.getVersion());
  const entries = useMemo(() => exercisePackageRegistry.packages.map(exercisePackage => Object.freeze({ exercisePackage, compatibility: exercisePackageValidator.compatibility(exercisePackage) })), []);
  const profiles = useMemo(() => [...new Set(entries.map(entry => entry.exercisePackage.definition.profile))].sort() as ExerciseProfile[], [entries]);
  const tags = useMemo(() => listExerciseCatalogTags(entries), [entries]);
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState<ExerciseProfile>();
  const [compatibility, setCompatibility] = useState<ExercisePackageCompatibility>();
  const [tag, setTag] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<string | undefined>(keyOf(entries[0]));
  const [activationFeedback, setActivationFeedback] = useState<Readonly<{ key: string; activePackageKey?: string; message?: string; error?: string }>>({ key: "" });
  const filtered = useMemo(() => filterExerciseCatalog(entries, { search, profile, compatibility, tag }), [entries, search, profile, compatibility, tag]);
  const selected = useMemo(() => resolveCatalogSelection(filtered, selectedKey), [filtered, selectedKey]);
  const active = activeExercisePackageService.getActive();
  const activeKey = active ? `${active.packageId}@${active.packageVersion}` : undefined;
  const projectedActiveKey = projectCatalogActiveKey(activeKey, activationFeedback.activePackageKey);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const activateSelected = () => {
    const result = activateCatalogEntry(selected, activeExercisePackageService);
    const key = keyOf(selected) ?? "";
    setActivationFeedback(result.ok
      ? { key, activePackageKey: result.activePackageKey, message: result.changed ? "Pakett aktiveeritud." : "Pakett on juba aktiivne." }
      : { key, error: result.message });
  };

  return <ScrollView contentContainerStyle={styles.container}>
    <View style={styles.top}><View><Text style={styles.title}>Õppuste kataloog</Text><Text style={styles.subtitle}>ExercisePackageRegistry kanoonilised paketid</Text></View><Pressable onPress={() => router.back()}><Text style={styles.back}>Tagasi</Text></Pressable></View>
    <PackageFilters search={search} profile={profile} compatibility={compatibility} tag={tag} profiles={profiles} tags={tags} onSearch={setSearch} onProfile={setProfile} onCompatibility={setCompatibility} onTag={setTag} />
    <Text style={styles.count}>{filtered.length} / {entries.length} paketti</Text>
    <View style={[styles.layout, desktop && styles.desktop]}>
      <View style={styles.list}><PackageList entries={filtered} activeKey={projectedActiveKey} selectedKey={keyOf(selected)} onSelect={entry => setSelectedKey(keyOf(entry))} /></View>
      <View style={styles.detail}><PackageDetail entry={selected} active={keyOf(selected) === projectedActiveKey} activationMessage={activationFeedback.key === keyOf(selected) ? activationFeedback.message : undefined} activationError={activationFeedback.key === keyOf(selected) ? activationFeedback.error : undefined} onActivate={activateSelected} /></View>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 18, paddingBottom: 40, backgroundColor: "#f7f8fa" }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }, title: { color: "#172b4d", fontSize: 28, fontWeight: "900" }, subtitle: { color: "#6b778c", marginTop: 3 }, back: { color: "#005bbb", fontWeight: "900", padding: 6 }, count: { color: "#6b778c", fontWeight: "700", marginBottom: 8 },
  layout: { gap: 14 }, desktop: { flexDirection: "row", alignItems: "flex-start" }, list: { flex: 1, minWidth: 0 }, detail: { flex: 1.25, minWidth: 0 },
});
