import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getPatientResourceDebugSnapshot, getResourceRuntimeDebugVersion, subscribeToResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { handleResourceInterventionCommand } from "@/services/runtime/instructor/ResourceInterventionCommandService";

export function PleuralDrainControls({ patientId, readOnly = false }: Readonly<{ patientId: string; readOnly?: boolean }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  const resources = getPatientResourceDebugSnapshot(patientId).resources.filter(resource => resource.type === "chestDrain" && resource.status === "AVAILABLE");
  const [message, setMessage] = useState<string>();
  if (readOnly || resources.length === 0) return null;
  return <View style={styles.card} testID="canonical-pleural-drain-controls">
    <Text style={styles.title}>Pleuradrenaaž</Text>
    <Text style={styles.help}>Paigalda rindkeredreen kanoonilise pleuravigastuse raviks.</Text>
    {resources.map(resource => <Pressable key={resource.resourceId} style={styles.button} onPress={() => {
      const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
      const result = handleResourceInterventionCommand({ commandId: `PLEURAL-DRAIN-${exerciseId}-${patientId}-${resource.resourceId}`,
        exerciseId, patientId, resourceId: resource.resourceId, issuedBy: "Case Manager" });
      setMessage(result.ok ? "Rindkeredreen paigaldatud." : result.message);
    }}><Text style={styles.buttonText}>Paigalda rindkeredreen</Text></Pressable>)}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#7dd3fc", borderRadius: 10, padding: 12, gap: 8, marginBottom: 12 },
  title: { color: "#075985", fontWeight: "900", fontSize: 18 }, help: { color: "#334155" },
  button: { backgroundColor: "#0369a1", padding: 12, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }, message: { color: "#075985", fontWeight: "700" },
});
