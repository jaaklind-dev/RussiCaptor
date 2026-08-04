import { getExerciseTimelineSnapshot, getExerciseTimelineVersion, subscribeToExerciseTimeline } from "@/services/ExerciseTimelineService";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useSyncExternalStore } from "react";
export default function ExerciseTimelineDetailScreen() {
  useSyncExternalStore(subscribeToExerciseTimeline, getExerciseTimelineVersion, getExerciseTimelineVersion);
  const { id } = useLocalSearchParams<{ id: string }>(); const event = getExerciseTimelineSnapshot().find(item => item.id === id);
  return <ScrollView contentContainerStyle={styles.container}><Pressable onPress={() => router.back()}><Text style={styles.back}>← Timeline</Text></Pressable><Text style={styles.title}>{event?.title ?? "Timeline event not found"}</Text>{event && <View style={styles.card}>
    <Row label="Event ID" value={event.id} /><Row label="Simulation time" value={`T+${event.simulationTimeSec}s`} /><Row label="Sequence" value={String(event.sequenceNumber)} /><Row label="Category" value={event.category} /><Row label="Type" value={event.type} /><Row label="Severity" value={event.severity} /><Row label="Exercise" value={event.exerciseId} /><Row label="Patient" value={event.patientId} /><Row label="Issuer" value={event.issuedBy} /><Row label="Description" value={event.description} /><Text style={styles.label}>Metadata</Text><Text selectable style={styles.json}>{JSON.stringify(event.metadata ?? {}, null, 2)}</Text>
  </View>}</ScrollView>;
}
function Row({ label, value }: { label: string; value?: string }) { if (!value) return null; return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({ container: { padding: 20, backgroundColor: "#fff", flexGrow: 1 }, back: { color: "#005bbb", fontWeight: "800", marginBottom: 18 }, title: { color: "#172b4d", fontSize: 26, fontWeight: "900", marginBottom: 16 }, card: { backgroundColor: "#f4f5f7", borderRadius: 14, padding: 16 }, row: { marginBottom: 12 }, label: { color: "#6b778c", fontSize: 12, fontWeight: "800", marginBottom: 3 }, value: { color: "#172b4d", fontSize: 15 }, json: { color: "#172b4d", fontFamily: "monospace", backgroundColor: "#fff", padding: 10, borderRadius: 8 } });
