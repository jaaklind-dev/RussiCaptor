import { getExerciseTimelineSnapshot, getExerciseTimelineVersion, subscribeToExerciseTimeline } from "@/services/ExerciseTimelineService";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useSyncExternalStore } from "react";
import { timelineActorLabel, timelineCategoryLabel, timelineEventDescriptionLabel, timelineEventTitleLabel, timelineSeverityLabel } from "@/localization/dataDrivenEt";
export default function ExerciseTimelineDetailScreen() {
  useSyncExternalStore(subscribeToExerciseTimeline, getExerciseTimelineVersion, getExerciseTimelineVersion);
  const { id } = useLocalSearchParams<{ id: string }>(); const event = getExerciseTimelineSnapshot().find(item => item.id === id);
  return <ScrollView contentContainerStyle={styles.container}><Pressable onPress={() => router.back()}><Text style={styles.back}>← Ajajoon</Text></Pressable><Text style={styles.title}>{event ? timelineEventTitleLabel(event) : "Ajajoone sündmust ei leitud"}</Text>{event && <View style={styles.card}>
    <Row label="Sündmuse ID" value={event.id} /><Row label="Simulatsiooniaeg" value={`T+${event.simulationTimeSec}s`} /><Row label="Järjekorranumber" value={String(event.sequenceNumber)} /><Row label="Kategooria" value={timelineCategoryLabel(event.category)} /><Row label="Tüüp" value={event.type} /><Row label="Raskusaste" value={timelineSeverityLabel(event.severity)} /><Row label="Õppus" value={event.exerciseId} /><Row label="Patsient" value={event.patientId} /><Row label="Algataja" value={event.issuedBy ? timelineActorLabel(event.issuedBy) : undefined} /><Row label="Kirjeldus" value={timelineEventDescriptionLabel(event.description)} /><Text style={styles.label}>Metaandmed</Text><Text selectable style={styles.json}>{JSON.stringify(event.metadata ?? {}, null, 2)}</Text>
  </View>}</ScrollView>;
}
function Row({ label, value }: { label: string; value?: string }) { if (!value) return null; return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({ container: { padding: 20, backgroundColor: "#fff", flexGrow: 1 }, back: { color: "#005bbb", fontWeight: "800", marginBottom: 18 }, title: { color: "#172b4d", fontSize: 26, fontWeight: "900", marginBottom: 16 }, card: { backgroundColor: "#f4f5f7", borderRadius: 14, padding: 16 }, row: { marginBottom: 12 }, label: { color: "#6b778c", fontSize: 12, fontWeight: "800", marginBottom: 3 }, value: { color: "#172b4d", fontSize: 15 }, json: { color: "#172b4d", fontFamily: "monospace", backgroundColor: "#fff", padding: 10, borderRadius: 8 } });
