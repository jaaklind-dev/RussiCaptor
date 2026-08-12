import { getPatientResourceDebugSnapshot, getResourceRuntimeDebugVersion, subscribeToResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { inferredInterventionDefinitionId } from "@/services/runtime/clinical/InterventionRuntime";
import { advancePatientRuntime, handleResourceInterventionCommand, type ResourceInterventionCommandResult } from "@/services/runtime/instructor/ResourceInterventionCommandService";
import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function InspectorResourceInterventions({ exerciseId, patientId }: Readonly<{ exerciseId: string; patientId: string }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const available = snapshot.resources.filter(resource => resource.status === "AVAILABLE" && inferredInterventionDefinitionId(resource));
  const [submitting, setSubmitting] = useState<string>();
  const [result, setResult] = useState<ResourceInterventionCommandResult>();
  const apply = (resourceId: string) => {
    if (submitting) return;
    setSubmitting(resourceId); setResult(undefined);
    setResult(handleResourceInterventionCommand({ commandId: `RESOURCE-${patientId}-${resourceId}`,
      exerciseId, patientId, resourceId, issuedBy: "Exercise Controller" }));
    setSubmitting(undefined);
  };
  return <View style={styles.card} testID="resource-intervention-card">
    <Text style={styles.title}>Available resource interventions</Text>
    <Text style={styles.help}>Canonical resource path · advances the clinical reference by 60 seconds.</Text>
    {available.map(resource => <Pressable key={resource.resourceId} disabled={Boolean(submitting)}
      onPress={() => apply(resource.resourceId)} style={styles.button}>
      <Text style={styles.buttonText}>{submitting === resource.resourceId ? "Applying…" : `Apply ${resource.type}`}</Text>
    </Pressable>)}
    <Pressable disabled={Boolean(submitting)} onPress={() => {
      const commandId = `RUNTIME-${patientId}-${snapshot.updatedAt + 60}`;
      setResult(advancePatientRuntime({ commandId, exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" }));
    }} style={styles.advance}><Text style={styles.buttonText}>Advance clinical runtime 60s</Text></Pressable>
    {result?.ok && <Text style={styles.success}>Intervention applied to canonical runtime.</Text>}
    {result && !result.ok && <Text style={styles.error}>{result.errorCode}: {result.message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#86efac", borderRadius: 12, padding: 14, gap: 8 },
  title: { color: "#166534", fontSize: 18, fontWeight: "900" }, help: { color: "#3f6212", fontSize: 12 },
  button: { backgroundColor: "#15803d", padding: 12, borderRadius: 10, alignItems: "center" },
  advance: { backgroundColor: "#0369a1", padding: 12, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }, success: { color: "#15803d", fontWeight: "700" },
  error: { color: "#b91c1c", fontWeight: "700" },
});
