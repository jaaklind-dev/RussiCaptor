import { InstructorFilterBar } from "@/components/instructor/InstructorFilterBar";
import { InstructorPatientCard } from "@/components/instructor/InstructorPatientCard";
import ResourceMonitorCard from "@/components/dashboard/ResourceMonitorCard";
import type { InstructorDashboardFilters } from "@/models/InstructorDashboard";
import {
  getInstructorDashboardSnapshot, getInstructorDashboardVersion, subscribeToInstructorDashboard,
} from "@/services/InstructorDashboardService";
import { filterInstructorPatients } from "@/services/runtime/selectors/InstructorDashboardSelector";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import ExerciseControlsCard from "@/components/excon/ExerciseControlsCard";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { initializeAuthoritativeExerciseRuntime } from "@/services/runtime/exercise/AuthoritativeExerciseRuntime";
import { ExerciseInformationCard } from "@/components/excon/ExerciseInformationCard";
import { getExerciseDefinition } from "@/services/exercise/ExerciseDefinitionService";

const initialFilters: InstructorDashboardFilters = {
  location: "All", triage: "All", caseManager: "All", status: "All",
};
const unique = (values: string[]) => ["All", ...new Set(values.filter(Boolean).sort())];

export default function ExerciseDashboardScreen() {
  useSyncExternalStore(subscribeToInstructorDashboard, getInstructorDashboardVersion, getInstructorDashboardVersion);
  const snapshot = getInstructorDashboardSnapshot();
  const exerciseSnapshot = getCanonicalExerciseSnapshot();
  const exerciseDefinition = getExerciseDefinition(exerciseSnapshot.exerciseId);
  useEffect(() => initializeAuthoritativeExerciseRuntime(exerciseSnapshot.exerciseId), [exerciseSnapshot.exerciseId]);
  const [filters, setFilters] = useState(initialFilters);
  const { width } = useWindowDimensions();
  const columns = width >= 1180 ? 4 : width >= 860 ? 3 : width >= 560 ? 2 : 1;
  const visiblePatients = useMemo(() => filterInstructorPatients(snapshot.patients, filters), [snapshot.patients, filters]);
  const options = useMemo(() => ({
    location: unique(["EMO", "Resus", "OR", "ICU", "Ward", ...snapshot.patients.map(item => item.location)]),
    triage: unique(["P1", "P2", "P3", "Expectant", ...snapshot.patients.map(item => item.triage)]),
    caseManager: unique(snapshot.patients.map(item => item.caseManagerName ?? "")),
    status: unique(["Stable", "Critical", "Completed", ...snapshot.patients.map(item => item.status)]),
  }), [snapshot.patients]);
  const openPatient = useCallback((patientId: string) => router.push(`/excon/patient/${patientId}`), []);

  return (
    <FlatList
      key={columns}
      data={visiblePatients}
      numColumns={columns}
      keyExtractor={item => item.patientId}
      contentContainerStyle={styles.container}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      renderItem={({ item }) => <InstructorPatientCard patient={item} onPress={openPatient} />}
      ListHeaderComponent={(
        <View>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.title}>Exercise Dashboard</Text>
              <Text style={styles.exercise}>{snapshot.exerciseName}</Text>
            </View>
            <View style={styles.exerciseState}>
              <Text style={styles.exerciseTime}>T+{snapshot.exerciseTimeSec}s</Text>
              <Text style={[styles.state, snapshot.exerciseState === "RUNNING" ? styles.running : styles.paused]}>
                {snapshot.exerciseState} · ×{snapshot.exerciseSpeed}
              </Text>
            </View>
          </View>
          <ExerciseControlsCard snapshot={exerciseSnapshot} />
          <ExerciseInformationCard definition={exerciseDefinition} />
          <Pressable style={styles.timelineButton} onPress={() => router.push("/excon/timeline")}><Text style={styles.timelineButtonText}>Open Exercise Timeline</Text></Pressable>
          <Pressable style={styles.debriefButton} onPress={() => router.push("/excon/debrief")}><Text style={styles.timelineButtonText}>Open Debrief</Text></Pressable>
          <InstructorFilterBar
            filters={filters}
            options={options}
            onChange={(key, value) => setFilters(current => ({ ...current, [key]: value }))}
          />
          {__DEV__ && <ResourceMonitorCard />}
          <Text style={styles.count}>{visiblePatients.length} / {snapshot.patients.length} patients</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No patients match the selected filters.</Text>}
      ListFooterComponent={(
        <Pressable style={styles.backButton} onPress={() => router.replace("/excon")}>
          <Text style={styles.backText}>Back to Exercise Controller</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 36, backgroundColor: "#fff", flexGrow: 1 },
  row: { alignItems: "stretch" }, topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 28, fontWeight: "800", color: "#172b4d" }, exercise: { color: "#42526e", fontSize: 16, marginTop: 2 },
  exerciseState: { alignItems: "flex-end" }, exerciseTime: { fontVariant: ["tabular-nums"], fontWeight: "800", color: "#172b4d" },
  state: { marginTop: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden", fontWeight: "800", fontSize: 11 },
  running: { color: "#1b5e20", backgroundColor: "#e8f5e9" }, paused: { color: "#7a5700", backgroundColor: "#fff8dc" },
  count: { marginBottom: 5, color: "#6b778c", fontWeight: "700" }, empty: { textAlign: "center", padding: 30, color: "#6b778c" },
  backButton: { marginTop: 20, borderColor: "#005bbb", borderWidth: 2, borderRadius: 12, padding: 13, alignItems: "center" },
  backText: { color: "#005bbb", fontWeight: "800" },
  timelineButton: { backgroundColor: "#172b4d", borderRadius: 10, padding: 12, alignItems: "center", marginBottom: 14 },
  debriefButton: { backgroundColor: "#005bbb", borderRadius: 10, padding: 12, alignItems: "center", marginBottom: 14 },
  timelineButtonText: { color: "#fff", fontWeight: "800" },
});
