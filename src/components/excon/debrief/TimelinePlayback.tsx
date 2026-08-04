import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { PlaybackCursor } from "@/services/debrief/DebriefModel";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function TimelinePlaybackControls({ cursor, durationSec, previous, next, onToggle, onSeek }: { cursor: PlaybackCursor; durationSec: number; previous?: ExerciseTimelineEvent; next?: ExerciseTimelineEvent; onToggle: () => void; onSeek: (seconds: number, event?: ExerciseTimelineEvent) => void }) {
  return <View style={styles.card}><View style={styles.row}><Text style={styles.title}>Timeline Playback</Text><Text style={styles.time}>T+{cursor.simulationTimeSec}s / {durationSec}s</Text></View>
    <View style={styles.controls}>
      <Pressable style={styles.secondary} disabled={!previous} onPress={() => previous && onSeek(previous.simulationTimeSec, previous)}><Text style={styles.secondaryText}>Previous event</Text></Pressable>
      <Pressable style={styles.primary} onPress={onToggle}><Text style={styles.primaryText}>{cursor.playing ? "Pause" : "Play"}</Text></Pressable>
      <Pressable style={styles.secondary} disabled={!next} onPress={() => next && onSeek(next.simulationTimeSec, next)}><Text style={styles.secondaryText}>Next event</Text></Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 12, padding: 14, marginBottom: 12 }, row: { flexDirection: "row", justifyContent: "space-between" }, title: { fontSize: 17, fontWeight: "900", color: "#172b4d" }, time: { fontWeight: "800", color: "#42526e", fontVariant: ["tabular-nums"] }, controls: { flexDirection: "row", gap: 8, marginTop: 12 }, primary: { backgroundColor: "#005bbb", padding: 10, borderRadius: 8, flex: 1, alignItems: "center" }, primaryText: { color: "#fff", fontWeight: "900" }, secondary: { borderColor: "#005bbb", borderWidth: 1, padding: 9, borderRadius: 8, flex: 1, alignItems: "center" }, secondaryText: { color: "#005bbb", fontWeight: "800", fontSize: 12 } });

