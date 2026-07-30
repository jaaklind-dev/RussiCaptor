import { InspectorClinicalState } from "@/components/instructor/InspectorClinicalState";
import { InspectorClinicalTabs } from "@/components/instructor/InspectorClinicalTabs";
import { InspectorHeader } from "@/components/instructor/InspectorHeader";
import { InspectorListPanel } from "@/components/instructor/InspectorListPanel";
import { InspectorTimeline } from "@/components/instructor/InspectorTimeline";
import { InstructorEventInjectionModal } from "@/components/instructor/InstructorEventInjectionModal";
import type { InspectorTab } from "@/models/InstructorPatientInspector";
import {
  getInstructorPatientInspector, getInstructorPatientInspectorVersion, subscribeToInstructorPatientInspector,
} from "@/services/InstructorPatientInspectorService";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

export default function InstructorPatientInspectorStub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useSyncExternalStore(
    subscribeToInstructorPatientInspector,
    getInstructorPatientInspectorVersion,
    getInstructorPatientInspectorVersion
  );
  const model = getInstructorPatientInspector(id);
  const [injectionOpen, setInjectionOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  if (!model) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.title}>Patient not found</Text>
        <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Back to Instructor Dashboard</Text></Pressable>
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
        <Text style={styles.title}>Instructor Patient Inspector</Text>
        <View style={styles.actions}><Pressable style={styles.injectButton} onPress={() => setInjectionOpen(true)}><Text style={styles.injectButtonText}>Inject event</Text></Pressable>
          <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Back to Dashboard</Text></Pressable></View>
      </View>
      <InspectorHeader header={model.header} />
      <View style={[styles.columns, !desktop && styles.stacked]}>
        <View style={styles.leftColumn}>
          <InspectorClinicalState state={model.clinicalState} />
          <InspectorListPanel title="Active Patient Processes" items={model.processes} emptyText="No active patient processes" />
          <InspectorListPanel title="Active Clinical Effects" items={model.effects} emptyText="No active clinical effects" />
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
