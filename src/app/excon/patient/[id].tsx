import { InspectorClinicalState } from "@/components/instructor/InspectorClinicalState";
import { InspectorCardiacState } from "@/components/instructor/InspectorCardiacState";
import { InspectorClinicalTabs } from "@/components/instructor/InspectorClinicalTabs";
import { InspectorHeader } from "@/components/instructor/InspectorHeader";
import { InspectorListPanel } from "@/components/instructor/InspectorListPanel";
import { InspectorTimeline } from "@/components/instructor/InspectorTimeline";
import { InstructorEventInjectionModal } from "@/components/instructor/InstructorEventInjectionModal";
import { InspectorResourceInterventions } from "@/components/instructor/InspectorResourceInterventions";
import type { InspectorTab } from "@/models/InstructorPatientInspector";
import {
  getInstructorPatientInspector, getInstructorPatientInspectorVersion, subscribeToInstructorPatientInspector,
} from "@/services/InstructorPatientInspectorService";
import { router, useLocalSearchParams } from "expo-router";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

export default function PatientInspectorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectorVersion = useSyncExternalStore(
    subscribeToInstructorPatientInspector,
    getInstructorPatientInspectorVersion,
    getInstructorPatientInspectorVersion
  );
  const model = getInstructorPatientInspector(id, inspectorVersion);
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const [injectionOpen, setInjectionOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  if (!model) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.title}>Patsienti ei leitud</Text>
        <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Tagasi õppuse töölauale</Text></Pressable>
      </View>
    );
  }
  const tabData: Record<InspectorTab, typeof model.interventions> = {
    Interventions: model.interventions, Medications: model.medications, Labs: model.labs,
    Imaging: model.imaging, Orders: model.orders, Notes: model.notes,
  };
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.topRow, !desktop && styles.topRowStacked]}>
        <Text style={styles.title}>Patsiendi inspektor</Text>
        <View style={styles.actions}><Pressable style={styles.injectButton} onPress={() => setInjectionOpen(true)}><Text style={styles.injectButtonText}>Lisa sündmus</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Tagasi töölauale</Text></Pressable></View>
      </View>
      <InspectorHeader header={model.header} />
      <View style={[styles.columns, !desktop && styles.stacked]}>
        <View style={styles.leftColumn}>
          {model.cardiac && <InspectorCardiacState exerciseId={exerciseId} patientId={model.header.patientId} cardiac={model.cardiac} />}
          <InspectorResourceInterventions patientId={model.header.patientId} />
          <InspectorClinicalState state={model.clinicalState} />
          <InspectorListPanel title="Aktiivsed patsiendiprotsessid" items={model.processes} emptyText="Aktiivseid patsiendiprotsesse pole" />
          <InspectorListPanel title="Aktiivsed kliinilised toimed" items={model.effects} emptyText="Aktiivseid kliinilisi toimeid pole" />
          <InspectorListPanel title="Ownership History" items={model.ownershipHistory} emptyText="No ownership events" />
        </View>
        <View style={styles.rightColumn}><InspectorTimeline items={model.timeline} scrollEnabled={desktop} /></View>
      </View>
      <InspectorClinicalTabs data={tabData} />
      <InstructorEventInjectionModal visible={injectionOpen} onClose={() => setInjectionOpen(false)} patient={{ patientId: model.header.patientId, name: model.header.name, location: model.header.location, simulationTimeSec: model.header.simulationTimeSec }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 36, backgroundColor: "#fff", gap: 14 }, notFound: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, topRowStacked: { flexDirection: "column", alignItems: "stretch" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }, injectButton: { backgroundColor: "#005bbb", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }, injectButtonText: { color: "#fff", fontWeight: "800" },
  title: { fontSize: 26, fontWeight: "800", color: "#172b4d" }, columns: { flexDirection: "row", gap: 14, minHeight: 560 },
  stacked: { flexDirection: "column" }, leftColumn: { flex: 1, gap: 12 }, rightColumn: { flex: 1 },
  button: { borderWidth: 2, borderColor: "#005bbb", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9 },
  buttonText: { color: "#005bbb", fontWeight: "800" },
});
