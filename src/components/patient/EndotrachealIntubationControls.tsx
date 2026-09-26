import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getPatientResourceDebugSnapshot, getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { airwayResourceLabel, selectEndotrachealIntubationOptions } from
  "@/services/runtime/clinical/EndotrachealIntubationSelector";
import { createEndotrachealIntubationCommandId, submitEndotrachealIntubationCommand } from
  "@/services/runtime/instructor/EndotrachealIntubationCommandService";
import { getRuntimeReaderConvergenceVersion, subscribeToRuntimeReaderConvergence } from
  "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import { runtimePatientCommandSubmissionReadiness } from
  "@/services/runtime/commands/RuntimePatientCommandService";

export function EndotrachealIntubationControls({ patientId, readOnly = false }:
  Readonly<{ patientId: string; readOnly?: boolean }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  useSyncExternalStore(subscribeToRuntimeReaderConvergence, getRuntimeReaderConvergenceVersion,
    getRuntimeReaderConvergenceVersion);
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const commandReadiness = runtimePatientCommandSubmissionReadiness(exerciseId);
  const options = selectEndotrachealIntubationOptions(snapshot.resources);
  const active = (snapshot.clinicalInterventions ?? []).find(item =>
    item.definitionId === "ENDOTRACHEAL_INTUBATION" && item.status === "RUNNING");
  const [tubeId, setTubeId] = useState<string>();
  const [scopeId, setScopeId] = useState<string>();
  const [capnographyId, setCapnographyId] = useState<string>();
  const [tubeSize, setTubeSize] = useState("7.5");
  const [cuff, setCuff] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string>();
  const submitting = useRef(false);

  if (readOnly || (!active && !options.available)) return null;
  const selectedTube = options.tubes.find(item => item.resourceId === tubeId);
  const selectedScope = options.laryngoscopes.find(item => item.resourceId === scopeId);
  const chooseTube = (resourceId: string) => {
    setTubeId(resourceId);
    const size = options.tubes.find(item => item.resourceId === resourceId)?.metadata.tubeSize;
    if (typeof size === "number") setTubeSize(String(size));
  };
  return <View style={styles.card} testID="endotracheal-intubation-controls">
    <Text style={styles.title}>Endotrahheaalne intubatsioon</Text>
    {active ? <Text style={styles.success}>Hingamistee on intubeeritud ja toru asend kinnitatud.</Text> : <>
      <Text style={styles.label}>Vali endotrahheaaltoru</Text>
      {options.tubes.map(resource => <Pressable key={resource.resourceId} onPress={() => chooseTube(resource.resourceId)}
        style={[styles.row, tubeId === resource.resourceId && styles.selected]}>
        <Text style={styles.rowText}>{airwayResourceLabel(resource)}</Text>
      </Pressable>)}
      <Text style={styles.label}>Vali larüngoskoop</Text>
      {options.laryngoscopes.map(resource => <Pressable key={resource.resourceId} onPress={() => setScopeId(resource.resourceId)}
        style={[styles.row, scopeId === resource.resourceId && styles.selected]}>
        <Text style={styles.rowText}>{airwayResourceLabel(resource)}</Text>
      </Pressable>)}
      <Text style={styles.label}>Toru suurus</Text>
      <TextInput style={styles.input} value={tubeSize} onChangeText={setTubeSize} keyboardType="decimal-pad"
        editable={typeof selectedTube?.metadata.tubeSize !== "number"} />
      <View style={styles.toggle}><Text style={styles.rowText}>Mansetiga toru</Text><Switch value={cuff} onValueChange={setCuff} /></View>
      {options.capnography.map(resource => <Pressable key={resource.resourceId}
        onPress={() => setCapnographyId(capnographyId === resource.resourceId ? undefined : resource.resourceId)}
        style={[styles.row, capnographyId === resource.resourceId && styles.selected]}>
        <Text style={styles.rowText}>Kapnograafia: {airwayResourceLabel(resource)}</Text>
      </Pressable>)}
      <View style={styles.toggle}><Text style={styles.rowText}>Toru asend kinnitatud</Text>
        <Switch value={confirmed} onValueChange={setConfirmed} /></View>
      <Pressable testID="start-endotracheal-intubation"
        disabled={!selectedTube || !selectedScope || !confirmed || !commandReadiness.ready}
        style={[styles.button, (!selectedTube || !selectedScope || !confirmed || !commandReadiness.ready) && styles.disabled]} onPress={() => {
          if (submitting.current || !selectedTube || !selectedScope) return;
          submitting.current = true;
          setMessage("Käsk ootab serveri kinnitust…");
          void submitEndotrachealIntubationCommand({
              commandId: createEndotrachealIntubationCommandId(exerciseId, patientId), exerciseId, patientId,
              tubeResourceId: selectedTube.resourceId, laryngoscopeResourceId: selectedScope.resourceId,
              capnographyResourceId: capnographyId,
              device: selectedScope.type === "videoLaryngoscope" ? "VIDEO" : "DIRECT",
              tubeSize: Number(tubeSize.replace(",", ".")), cuff, confirmation: confirmed, issuedBy: "Case Manager",
            }).then(result => setMessage(result.ok ? "Endotrahheaalse intubatsiooni korraldus vastu võetud." : result.message))
            .catch(() => setMessage("Intubatsioonikäsku ei saanud tööjärjekorda saata."))
            .finally(() => { submitting.current = false; });
        }}><Text style={styles.buttonText}>Alusta intubatsiooni</Text></Pressable>
      {!commandReadiness.ready && <Text style={styles.message}>Patsiendi andmeid sünkroniseeritakse…</Text>}
    </>}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#0f766e", borderRadius: 10, padding: 12, gap: 10 },
  title: { color: "#115e59", fontWeight: "900", fontSize: 18 }, label: { color: "#334155", fontWeight: "700" },
  row: { minHeight: 48, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 10, padding: 12, justifyContent: "center" },
  selected: { borderColor: "#0f766e", backgroundColor: "#ccfbf1" }, rowText: { fontSize: 16, fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  toggle: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: "#0f766e", alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  success: { color: "#166534", fontWeight: "700" }, message: { color: "#334155", fontWeight: "700" },
});
