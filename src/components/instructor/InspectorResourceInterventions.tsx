import { getPatientResourceDebugSnapshot, getResourceRuntimeDebugVersion, subscribeToResourceRuntimeDebug } from "@/services/ResourceRuntimeDebugService";
import { inferredInterventionDefinitionId } from "@/services/runtime/clinical/InterventionRuntime";
import { advancePatientRuntime, createManualRuntimeAdvanceCommandId, handleResourceInterventionCommand, type ResourceInterventionCommandResult } from "@/services/runtime/instructor/ResourceInterventionCommandService";
import { useState, useSyncExternalStore } from "react";
import {
  getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots,
} from "@/services/RuntimeSnapshotService";
import { handleMtpCommand, type MtpAction } from "@/services/runtime/instructor/MassiveTransfusionCommandService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function InspectorResourceInterventions({ patientId }: Readonly<{ patientId: string }>) {
  useSyncExternalStore(subscribeToResourceRuntimeDebug, getResourceRuntimeDebugVersion, getResourceRuntimeDebugVersion);
  useSyncExternalStore(subscribeToRuntimeSnapshots, getRuntimeSnapshotVersion, getRuntimeSnapshotVersion);
  const snapshot = getPatientResourceDebugSnapshot(patientId);
  const available = snapshot.resources.filter(resource => resource.status === "AVAILABLE" && inferredInterventionDefinitionId(resource));
  const [submitting, setSubmitting] = useState<string>();
  const [result, setResult] = useState<ResourceInterventionCommandResult>();
  const mtp = getCanonicalPatientRuntimeSnapshot(patientId)?.processes.find(process => process.moduleId === "MASSIVE_TRANSFUSION_V1");
  const apply = (resourceId: string) => {
    if (submitting) return;
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    setSubmitting(resourceId); setResult(undefined);
    setResult(handleResourceInterventionCommand({ commandId: `RESOURCE-${patientId}-${resourceId}`,
      exerciseId, patientId, resourceId, issuedBy: "Exercise Controller" }));
    setSubmitting(undefined);
  };
  return <View style={styles.card} testID="resource-intervention-card">
    <Text style={styles.title}>Saadaval ressursipõhised sekkumised</Text>
    <Text style={styles.help}>Canonical resource path · advances the clinical reference by 60 seconds.</Text>
    {available.map(resource => <Pressable key={resource.resourceId} disabled={Boolean(submitting)}
      onPress={() => apply(resource.resourceId)} style={styles.button}>
      <Text style={styles.buttonText}>{submitting === resource.resourceId ? "Applying…" : `Apply ${resource.type}`}</Text>
    </Pressable>)}
    {mtp && <View style={styles.mtp}><Text style={styles.title}>Massiivse transfusiooni protokoll</Text>
      {(["MTP_ACTIVATION", "RBC_ADMINISTRATION", "PLASMA_ADMINISTRATION", "PLATELET_ADMINISTRATION"] as MtpAction[]).map(action =>
        <Pressable key={action} disabled={Boolean(submitting)} onPress={() => { const sequence = Array.isArray(mtp.clinicalState?.processedCommandIds) ? mtp.clinicalState.processedCommandIds.length : 0;
          const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
          const commandId = `MTP-${patientId}-${action}-${sequence}`; setSubmitting(action);
          const next = handleMtpCommand({ commandId, exerciseId, patientId, action, units: 1, issuedBy: "EXCON" });
          setResult(next.ok ? { ok: true, commandId, runtimeEventId: next.runtimeEventId } : { ok: false, commandId, errorCode: next.errorCode, message: next.message }); setSubmitting(undefined); }} style={styles.button}>
          <Text style={styles.buttonText}>{({ MTP_ACTIVATION: "Aktiveeri MTP", RBC_ADMINISTRATION: "Manusta 1 ühik erütrotsüüte", PLASMA_ADMINISTRATION: "Manusta 1 ühik plasmat", PLATELET_ADMINISTRATION: "Manusta 1 doos trombotsüüte" } as const)[action]}</Text>
        </Pressable>)}</View>}
    <Pressable disabled={Boolean(submitting)} onPress={() => {
      const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
      const commandId = createManualRuntimeAdvanceCommandId(exerciseId, patientId);
      setResult(advancePatientRuntime({ commandId, exerciseId, patientId, durationSec: 60, issuedBy: "Exercise Controller" }));
    }} style={styles.advance}><Text style={styles.buttonText}>Keri kliinilist simulatsiooni 60 s edasi</Text></Pressable>
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
  mtp: { gap: 8, borderTopWidth: 1, borderTopColor: "#86efac", paddingTop: 10 },
});
