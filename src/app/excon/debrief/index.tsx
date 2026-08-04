import { DebriefSummary } from "@/components/excon/debrief/DebriefSummary";
import { PatientPlayback } from "@/components/excon/debrief/PatientPlayback";
import { TimelinePlaybackControls } from "@/components/excon/debrief/TimelinePlayback";
import { getDebriefReport, getDebriefVersion, subscribeToDebrief } from "@/services/DebriefService";
import { filterDebriefPatients } from "@/services/debrief/DebriefSelectors";
import { advance, createPlaybackCursor, jumpToEvent, jumpToPatient, pause, play, seek } from "@/services/debrief/PlaybackController";
import { patientPlayback } from "@/services/debrief/PatientPlayback";
import { timelineAt } from "@/services/debrief/TimelinePlayback";
import type { PatientOutcome, PlaybackCursor } from "@/services/debrief/DebriefModel";
import type { ExerciseTimelineCategory } from "@/models/exercise/ExerciseTimelineEvent";
import { router } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ExerciseInformationCard } from "@/components/excon/ExerciseInformationCard";
import { ExercisePackageInformationCard } from "@/components/excon/ExercisePackageInformationCard";
import { exercisePackageValidator, getExercisePackage } from "@/services/exercise/ExercisePackageService";

const categories: readonly ExerciseTimelineCategory[] = ["EXERCISE", "PATIENT", "COMMAND", "AUDIT"];
const outcomes: readonly PatientOutcome[] = ["ALIVE", "DECEASED", "TRANSFERRED", "STILL_ACTIVE", "COMPLETED_SCENARIO"];

export default function DebriefScreen() {
  useSyncExternalStore(subscribeToDebrief, getDebriefVersion, getDebriefVersion);
  const report = getDebriefReport();
  const exercisePackage = getExercisePackage(report.exerciseId);
  const definition = exercisePackage.definition;
  const [cursor, setCursor] = useState<PlaybackCursor>(() => createPlaybackCursor());
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ExerciseTimelineCategory>();
  const [outcome, setOutcome] = useState<PatientOutcome>();
  const [caseManager, setCaseManager] = useState<string>();
  const [phaseOnly, setPhaseOnly] = useState(false);
  const caseManagers = [...new Set(report.patients.flatMap(item => item.assignedCaseManagers))].sort();
  const visiblePatients = filterDebriefPatients(report, {
    search, category, outcome, caseManager, exercisePhase: phaseOnly ? report.exerciseState : undefined,
  });
  const visibleTimeline = timelineAt(report.timeline, cursor.simulationTimeSec);
  const previous = visibleTimeline.at(-1);
  const next = report.timeline.find(event => event.simulationTimeSec > cursor.simulationTimeSec);
  const patient = cursor.selectedPatientId ? patientPlayback(report, cursor.selectedPatientId, cursor) : undefined;
  useEffect(() => {
    if (!cursor.playing) return;
    const timer = setInterval(() => setCursor(current => advance(current, 1, report.simulationDurationSec)), 1000);
    return () => clearInterval(timer);
  }, [cursor.playing, report.simulationDurationSec]);
  return <FlatList data={visibleTimeline} keyExtractor={event => event.id} contentContainerStyle={styles.container}
    ListHeaderComponent={<View><View style={styles.top}><View><Text style={styles.title}>Debrief</Text><Text style={styles.subtitle}>Canonical read-only exercise reconstruction</Text></View><Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable></View>
      <DebriefSummary report={report} />
      <ExercisePackageInformationCard exercisePackage={exercisePackage} compatibility={exercisePackageValidator.compatibility(exercisePackage)} />
      <ExerciseInformationCard definition={definition} />
      <Pressable style={styles.analyticsButton} onPress={() => router.push("/excon/analytics")}><Text style={styles.analyticsButtonText}>Open Analytics</Text></Pressable>
      <TimelinePlaybackControls cursor={cursor} durationSec={report.simulationDurationSec} previous={previous} next={next} onToggle={() => setCursor(current => current.playing ? pause(current) : play(current))} onSeek={(seconds, event) => setCursor(current => event ? jumpToEvent(current, event) : seek(current, seconds, report.simulationDurationSec))} />
      <TextInput value={search} onChangeText={setSearch} placeholder="Search patients" style={styles.input} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label={`Phase: ${report.exerciseState}`} active={phaseOnly} onPress={() => setPhaseOnly(value => !value)} />
        {categories.map(value => <FilterChip key={value} label={value} active={category === value} onPress={() => setCategory(current => current === value ? undefined : value)} />)}
        {outcomes.map(value => <FilterChip key={value} label={value.replaceAll("_", " ")} active={outcome === value} onPress={() => setOutcome(current => current === value ? undefined : value)} />)}
        {caseManagers.map(value => <FilterChip key={value} label={`CM: ${value}`} active={caseManager === value} onPress={() => setCaseManager(current => current === value ? undefined : value)} />)}
      </ScrollView>
      <View style={styles.chips}>{visiblePatients.map(item => <Pressable key={item.patientId} style={[styles.chip, cursor.selectedPatientId === item.patientId && styles.chipActive]} onPress={() => setCursor(current => jumpToPatient(current, item.patientId))}><Text style={styles.chipText}>{item.patientId}</Text></Pressable>)}</View>
      <PatientPlayback view={patient} /><Text style={styles.section}>Events visible at playback cursor · {visibleTimeline.length}</Text></View>}
    renderItem={({ item }) => <Pressable style={[styles.event, item.id === cursor.selectedEventId && styles.selected]} onPress={() => setCursor(current => jumpToEvent(current, item))}><Text style={styles.eventTime}>T+{item.simulationTimeSec}s · {item.category}</Text><Text style={styles.eventTitle}>{item.title}</Text><Text style={styles.eventMeta}>{item.patientId ?? "Exercise"}</Text></Pressable>}
    ListEmptyComponent={<Text style={styles.empty}>No events at this playback position.</Text>} />;
}
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}><Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ container: { backgroundColor: "#fff", flexGrow: 1, padding: 18, paddingBottom: 40 }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }, title: { fontSize: 28, fontWeight: "900", color: "#172b4d" }, subtitle: { color: "#5e6c84", marginTop: 3 }, back: { color: "#005bbb", fontWeight: "800" }, analyticsButton: { backgroundColor: "#005bbb", borderRadius: 9, padding: 11, alignItems: "center", marginBottom: 12 }, analyticsButtonText: { color: "#fff", fontWeight: "900" }, input: { borderWidth: 1, borderColor: "#c1c7d0", borderRadius: 9, padding: 10, marginBottom: 9 }, filterRow: { gap: 6, paddingBottom: 9 }, filterChip: { borderWidth: 1, borderColor: "#c1c7d0", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, filterChipActive: { backgroundColor: "#172b4d", borderColor: "#172b4d" }, filterChipText: { color: "#42526e", fontSize: 11, fontWeight: "800" }, filterChipTextActive: { color: "#fff" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }, chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: "#ebecf0" }, chipActive: { backgroundColor: "#b3d4ff" }, chipText: { fontWeight: "800", color: "#172b4d" }, section: { fontWeight: "900", color: "#172b4d", marginBottom: 8 }, event: { borderWidth: 1, borderColor: "#dfe1e6", borderRadius: 10, padding: 11, marginBottom: 8 }, selected: { borderColor: "#005bbb", backgroundColor: "#f0f7ff" }, eventTime: { fontSize: 11, color: "#6b778c", fontWeight: "700" }, eventTitle: { fontWeight: "900", color: "#172b4d", marginTop: 3 }, eventMeta: { color: "#5e6c84", marginTop: 2 }, empty: { textAlign: "center", color: "#6b778c", padding: 24 } });
