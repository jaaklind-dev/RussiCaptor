import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import {
  getPatientResourceDebugSnapshot,
  getResourceRuntimeDebugVersion,
  subscribeToResourceRuntimeDebug,
} from "@/services/ResourceRuntimeDebugService";
import { handleResourceInterventionCommand } from "@/services/runtime/instructor/ResourceInterventionCommandService";

export function PelvicBinderControls({ patientId, readOnly = false }: Readonly<{ patientId: string; readOnly?: boolean }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const binders = snapshot.resources.filter(resource => resource.type === "pelvicBinder" && resource.status === "AVAILABLE");
  const applied = (snapshot.clinicalInterventions ?? []).some(instance =>
    instance.definitionId === "PELVIC_BINDER_APPLICATION" && (instance.status === "RUNNING" || instance.status === "COMPLETED"));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();

  if (readOnly || (binders.length === 0 && !applied)) return null;
  return <View style={styles.card} testID="canonical-pelvic-binder-controls">
    <Text style={styles.title}>Vaagna stabiliseerimine</Text>
    {applied
      ? <Text style={styles.applied}>Vaagnalahas on paigaldatud.</Text>
      : binders.map(resource => <Pressable key={resource.resourceId} disabled={submitting} style={styles.button} onPress={() => {
        const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
        setSubmitting(true); setMessage(undefined);
        const result = handleResourceInterventionCommand({
          commandId: `PELVIC-BINDER-${exerciseId}-${patientId}-${resource.resourceId}`,
          exerciseId, patientId, resourceId: resource.resourceId, issuedBy: "Case Manager",
        });
        setMessage(result.ok ? "Vaagnalahas paigaldati." : result.message); setSubmitting(false);
      }}><Text style={styles.buttonText}>{submitting ? "Paigaldamine…" : "Paigalda vaagnalahas"}</Text></Pressable>)}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#f59e0b", borderRadius: 10, padding: 12, gap: 8 },
  title: { color: "#92400e", fontWeight: "900", fontSize: 18 },
  button: { backgroundColor: "#b45309", padding: 12, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "900" },
  applied: { color: "#166534", fontWeight: "700" },
  message: { color: "#92400e", fontWeight: "700" },
});
