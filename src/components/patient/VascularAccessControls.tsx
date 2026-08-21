import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getPatientResourceDebugSnapshot, getResourceRuntimeDebugVersion, subscribeToResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { handleResourceInterventionCommand } from "@/services/runtime/instructor/ResourceInterventionCommandService";

const labels = { peripheralIV: "Raja veenitee", centralVenousCatheter: "Raja tsentraalveenitee" } as const;

export function VascularAccessControls({ patientId, readOnly = false }: Readonly<{ patientId: string; readOnly?: boolean }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const resources = snapshot.resources.filter(resource =>
    resource.status === "AVAILABLE" && (resource.type === "peripheralIV" || resource.type === "centralVenousCatheter"));
  const accessInstances = (snapshot.clinicalInterventions ?? []).filter(instance =>
    instance.definitionId === "PERIPHERAL_IV_ACCESS" || instance.definitionId === "CENTRAL_VENOUS_ACCESS");
  const [submitting, setSubmitting] = useState<string>(); const [message, setMessage] = useState<string>();
  if (readOnly || (resources.length === 0 && accessInstances.length === 0)) return null;
  return <View style={styles.card} testID="canonical-vascular-access-controls">
    <Text style={styles.title}>Vaskulaarne ligipääs</Text>
    <Text style={styles.help}>Verekomponentide manustamisliinid tekivad kanoonilistest ligipääsusekkumistest.</Text>
    {accessInstances.map(instance => { const label = instance.definitionId === "CENTRAL_VENOUS_ACCESS" ? "Tsentraalveenitee" : "Perifeerne veenitee";
      const durationSec = instance.definitionId === "CENTRAL_VENOUS_ACCESS" ? 600 : 180;
      const remaining = Math.max(0, instance.startedAt + durationSec - snapshot.updatedAt);
      const minutes = Math.floor(remaining / 60).toString().padStart(2, "0"); const seconds = (remaining % 60).toString().padStart(2, "0");
      return <View key={instance.instanceId} style={styles.progress}><Text style={styles.progressTitle}>{label}</Text>
        <Text style={styles.progressText}>{instance.status === "RUNNING" ? `Rajamisel · ${minutes}:${seconds}`
          : instance.status === "COMPLETED" ? "Valmis" : instance.status === "CANCELLED" ? "Tühistatud" : "Ebaõnnestus"}</Text></View>; })}
    {resources.map(resource => <Pressable key={resource.resourceId} disabled={Boolean(submitting)} style={styles.button} onPress={() => {
      const exerciseId = getCanonicalExerciseSnapshot().exerciseId; setSubmitting(resource.resourceId); setMessage(undefined);
      const result = handleResourceInterventionCommand({ commandId: `ACCESS-${exerciseId}-${patientId}-${resource.resourceId}`,
        exerciseId, patientId, resourceId: resource.resourceId, issuedBy: "Case Manager" });
      setMessage(result.ok ? "Vaskulaarse ligipääsu rajamine algas." : result.message); setSubmitting(undefined);
    }}><Text style={styles.buttonText}>{submitting === resource.resourceId ? "Rajamine…" : labels[resource.type as keyof typeof labels]}</Text></Pressable>)}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#93c5fd", borderRadius: 10, padding: 12, gap: 8 },
  title: { color: "#1e3a8a", fontWeight: "900", fontSize: 18 }, help: { color: "#334155" },
  button: { backgroundColor: "#1d4ed8", padding: 12, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }, message: { color: "#1e40af", fontWeight: "700" },
  progress: { borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, padding: 10 },
  progressTitle: { color: "#1e3a8a", fontWeight: "900" }, progressText: { color: "#334155" },
});
