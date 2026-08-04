import { ExerciseTimelineEventCard } from "@/components/excon/ExerciseTimelineEventCard";
import { ExerciseTimelineFilterBar } from "@/components/excon/ExerciseTimelineFilterBar";
import type { ExerciseTimelineCategory, ExerciseTimelineGroup, ExerciseTimelineSeverity } from "@/models/exercise/ExerciseTimelineEvent";
import { getExerciseTimelineSnapshot, getExerciseTimelineVersion, subscribeToExerciseTimeline } from "@/services/ExerciseTimelineService";
import { filterExerciseTimeline, groupExerciseTimeline, newestExerciseTimelineFirst } from "@/services/runtime/selectors/ExerciseTimelineSelector";
import { router } from "expo-router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

type Row = { kind: "header"; key: string; title: string } | { kind: "event"; key: string; event: ReturnType<typeof getExerciseTimelineSnapshot>[number] };
export default function ExerciseTimelineScreen() {
  useSyncExternalStore(subscribeToExerciseTimeline, getExerciseTimelineVersion, getExerciseTimelineVersion);
  const timeline = getExerciseTimelineSnapshot(); const [categories, setCategories] = useState<ExerciseTimelineCategory[]>([]); const [severities, setSeverities] = useState<ExerciseTimelineSeverity[]>([]);
  const [patientId, setPatientId] = useState(""); const [caseManager, setCaseManager] = useState(""); const [search, setSearch] = useState(""); const [grouping, setGrouping] = useState<ExerciseTimelineGroup>("NONE");
  const rows = useMemo<Row[]>(() => groupExerciseTimeline(newestExerciseTimelineFirst(filterExerciseTimeline(timeline, { categories, severities, patientId, caseManager, search })), grouping)
    .flatMap(section => grouping === "NONE" ? section.events.map(event => ({ kind: "event" as const, key: event.id, event })) : [{ kind: "header" as const, key: `HEADER:${section.key}`, title: section.title }, ...section.events.map(event => ({ kind: "event" as const, key: event.id, event }))]), [timeline, categories, severities, patientId, caseManager, search, grouping]);
  const open = useCallback((id: string) => router.push({ pathname: "/excon/timeline/[id]", params: { id } }), []);
  return <FlatList data={rows} keyExtractor={item => item.key} contentContainerStyle={styles.container}
    ListHeaderComponent={<View><View style={styles.top}><View><Text style={styles.title}>Exercise Timeline</Text><Text style={styles.subtitle}>Canonical read-only event record</Text></View><Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable></View><ExerciseTimelineFilterBar categories={categories} severities={severities} patientId={patientId} caseManager={caseManager} search={search} grouping={grouping} onCategories={setCategories} onSeverities={setSeverities} onPatientId={setPatientId} onCaseManager={setCaseManager} onSearch={setSearch} onGrouping={setGrouping} /><Text style={styles.count}>{rows.filter(item => item.kind === "event").length} events</Text></View>}
    renderItem={({ item }) => item.kind === "header" ? <Text style={styles.section}>{item.title}</Text> : <ExerciseTimelineEventCard event={item.event} onPress={open} />}
    ListEmptyComponent={<Text style={styles.empty}>No timeline events match the filters.</Text>} />;
}
const styles = StyleSheet.create({ container: { padding: 18, paddingBottom: 40, backgroundColor: "#fff", flexGrow: 1 }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }, title: { fontSize: 28, fontWeight: "900", color: "#172b4d" }, subtitle: { color: "#5e6c84", marginTop: 3 }, back: { color: "#005bbb", fontWeight: "800" }, count: { color: "#6b778c", fontWeight: "700", marginBottom: 9 }, section: { color: "#172b4d", fontWeight: "900", fontSize: 17, marginVertical: 9 }, empty: { textAlign: "center", color: "#6b778c", padding: 30 } });
