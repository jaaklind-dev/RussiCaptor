import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { timelineActorLabel, timelineCategoryLabel, timelineEventTitleLabel } from "@/localization/dataDrivenEt";

const icons: Record<ExerciseTimelineEvent["category"], string> = { EXERCISE: "▶", PATIENT: "●", COMMAND: "⌁", SYSTEM: "⚙", AUDIT: "✓" };
function formatSimulationTime(seconds: number): string { const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

export const ExerciseTimelineEventCard = memo(function ExerciseTimelineEventCard({ event, onPress }: { event: ExerciseTimelineEvent; onPress: (id: string) => void }) {
  return <Pressable style={styles.card} onPress={() => onPress(event.id)}>
    <View style={styles.header}><Text style={styles.time}>{formatSimulationTime(event.simulationTimeSec)}</Text><Text style={styles.category}>{icons[event.category]} {timelineCategoryLabel(event.category)}</Text><View style={[styles.severity, styles[event.severity.toLowerCase() as "info" | "warning" | "error"]]} /></View>
    <Text style={styles.title}>{timelineEventTitleLabel(event)}</Text>
    {event.patientId && <Text style={styles.meta}>Patsient: {event.patientId}</Text>}
    {event.issuedBy && <Text style={styles.meta}>Autor: {timelineActorLabel(event.issuedBy)}</Text>}
  </Pressable>;
});
const styles = StyleSheet.create({ card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 12, padding: 14, marginBottom: 10 }, header: { flexDirection: "row", alignItems: "center", gap: 9 }, time: { color: "#172b4d", fontWeight: "900", fontVariant: ["tabular-nums"] }, category: { color: "#5e6c84", fontSize: 12, fontWeight: "800", flex: 1 }, severity: { width: 9, height: 9, borderRadius: 5 }, info: { backgroundColor: "#2e7d32" }, warning: { backgroundColor: "#f9a825" }, error: { backgroundColor: "#c62828" }, title: { color: "#172b4d", fontWeight: "800", fontSize: 16, marginTop: 8 }, meta: { color: "#42526e", marginTop: 4 } });
