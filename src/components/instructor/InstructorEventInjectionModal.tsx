import { instructorEventCatalogue } from "@/features/instructor/commands/InstructorEventCatalogue";
import { handleInstructorPatientCommand } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import { createInstructorPatientCommand } from "@/features/instructor/commands/InstructorCommandFactory";
import type { InstructorEventType } from "@/models/InstructorCommand";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getInstructorEventAvailability } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = { visible: boolean; patient: { patientId: string; name: string; location: string; simulationTimeSec?: number }; onClose: () => void };
type Submission = "Ready" | "Submitting" | "Succeeded" | "Failed";

export function InstructorEventInjectionModal({ visible, patient, onClose }: Props) {
  const exercise = getCanonicalExerciseSnapshot();
  const [selected, setSelected] = useState<InstructorEventType>();
  const [submission, setSubmission] = useState<Submission>("Ready");
  const definitions = instructorEventCatalogue.map(definition => ({
    definition, availability: getInstructorEventAvailability(exercise.exerciseId, patient.patientId, definition.eventType),
  }));
  const selectedDefinition = definitions.find(item => item.definition.eventType === selected);

  function submit() {
    if (!selectedDefinition?.availability.available || submission === "Submitting") return;
    setSubmission("Submitting");
    const next = handleInstructorPatientCommand(createInstructorPatientCommand({ exerciseId: exercise.exerciseId, patientId: patient.patientId,
      eventType: selectedDefinition.definition.eventType, issuedBy: "Exercise Controller", simulationTime: patient.simulationTimeSec ?? 0 }));
    setSubmission(next.ok ? "Succeeded" : "Failed");
  }

  function close() { setSelected(undefined); setSubmission("Ready"); onClose(); }
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
    <View style={styles.backdrop}><View style={styles.sheet}>
      <View style={styles.heading}><View><Text style={styles.title}>Lisa sündmus</Text><Text style={styles.patient}>{patient.name} · {patient.location}</Text></View>
        <Pressable accessibilityRole="button" onPress={close}><Text style={styles.close}>Sulge</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.list}>{definitions.map(({ definition, availability }) =>
        <Pressable key={definition.eventType} disabled={!availability.available || submission === "Submitting"}
          onPress={() => { setSelected(definition.eventType); setSubmission("Ready"); }}
          style={[styles.event, selected === definition.eventType && styles.selected, !availability.available && styles.disabled]}>
          <Text style={styles.eventTitle}>{definition.label}</Text><Text style={styles.description}>{definition.description}</Text>
          <Text style={[styles.availability, availability.available ? styles.available : styles.unavailable]}>{availability.available ? "Saadaval" : "Praegu pole saadaval"}</Text>
        </Pressable>)}</ScrollView>
      {selectedDefinition?.availability.available && <View style={styles.confirm}><Text style={styles.confirmText}>Kas lisada sündmus „{selectedDefinition.definition.label}”?</Text>
        <Text style={styles.description}>{patient.name} · {patient.location}</Text>
        <Pressable accessibilityRole="button" disabled={submission === "Submitting"} onPress={submit} style={[styles.submit, submission === "Submitting" && styles.disabled]}><Text style={styles.submitText}>{submission === "Submitting" ? "Lisan…" : "Kinnita sündmus"}</Text></Pressable></View>}
      {submission === "Succeeded" && <Text style={styles.success}>Sündmus on lisatud.</Text>}
      {submission === "Failed" && <Text style={styles.failure}>Sündmust ei saanud lisada. Proovi uuesti.</Text>}
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" }, sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "92%", gap: 12 },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, title: { fontSize: 24, fontWeight: "800", color: "#172b4d" }, patient: { color: "#475569", marginTop: 4 }, close: { color: "#005bbb", fontWeight: "800", padding: 8 }, list: { gap: 8 },
  event: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, padding: 12 }, selected: { borderWidth: 2, borderColor: "#005bbb", backgroundColor: "#eff6ff" }, disabled: { opacity: 0.5 }, eventTitle: { fontWeight: "800", color: "#172b4d" }, description: { color: "#475569", marginTop: 3 }, availability: { marginTop: 6, fontWeight: "700" }, available: { color: "#15803d" }, unavailable: { color: "#9f1239" },
  confirm: { borderTopWidth: 1, borderColor: "#e2e8f0", paddingTop: 12 }, confirmText: { fontWeight: "800", color: "#172b4d" }, submit: { marginTop: 10, backgroundColor: "#005bbb", borderRadius: 12, padding: 13, alignItems: "center" }, submitText: { color: "#fff", fontWeight: "800" }, success: { color: "#15803d", fontWeight: "800" }, failure: { color: "#b91c1c", fontWeight: "800" },
});
