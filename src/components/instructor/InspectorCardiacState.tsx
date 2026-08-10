import type { InstructorPatientInspectorModel } from "@/models/InstructorPatientInspector";
import type { CardiacInterventionAction, CardiacInterventionCommandResult } from "@/models/CardiacInterventionCommand";
import { handleCardiacInterventionCommand } from "@/services/runtime/instructor/CardiacInterventionCommandService";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = Readonly<{ exerciseId: string; patientId: string; cardiac: NonNullable<InstructorPatientInspectorModel["cardiac"]> }>;

export function InspectorCardiacState({ exerciseId, patientId, cardiac }: Props) {
  const [submitting, setSubmitting] = useState<CardiacInterventionAction>();
  const [result, setResult] = useState<CardiacInterventionCommandResult>();
  const issue = (action: CardiacInterventionAction) => {
    if (submitting) return;
    setSubmitting(action); setResult(undefined);
    const next = handleCardiacInterventionCommand({ commandId: `CARDIAC-${action}-${Date.now()}`, exerciseId, patientId, action, issuedBy: "Exercise Controller" });
    setResult(next); setSubmitting(undefined);
  };
  const arrest = cardiac.cardiacState === "ARREST";
  return <View style={styles.card} testID="cardiac-state-card">
    <Text style={styles.title}>Cardiac Arrest</Text>
    <View style={styles.grid}>
      <Text style={styles.label}>State</Text><Text style={styles.value}>{cardiac.cardiacState}</Text>
      <Text style={styles.label}>Rhythm</Text><Text style={styles.value}>{cardiac.rhythm}</Text>
      <Text style={styles.label}>Shockability</Text><Text style={styles.value}>{cardiac.rhythmClassification}</Text>
      <Text style={styles.label}>CPR</Text><Text style={styles.value}>{cardiac.cprActive ? "ACTIVE" : "STOPPED"}</Text>
      <Text style={styles.label}>Shock attempts</Text><Text style={styles.value}>{cardiac.shockAttemptCount}</Text>
      {cardiac.lastEvent && <><Text style={styles.label}>Last event</Text><Text style={styles.value}>{cardiac.lastEvent} · T+{cardiac.lastEventTimeSec ?? 0}s</Text></>}
    </View>
    <View style={styles.actions}>
      <Pressable disabled={Boolean(submitting) || !arrest} onPress={() => issue(cardiac.cprActive ? "STOP_CPR" : "START_CPR")}
        style={[styles.button, (Boolean(submitting) || !arrest) && styles.disabled]}><Text style={styles.buttonText}>{submitting?.includes("CPR") ? "Submitting…" : cardiac.cprActive ? "Stop CPR" : "Start CPR"}</Text></Pressable>
      <Pressable disabled={Boolean(submitting) || !arrest} onPress={() => issue("DEFIBRILLATION")}
        style={[styles.shock, (Boolean(submitting) || !arrest) && styles.disabled]}><Text style={styles.buttonText}>{submitting === "DEFIBRILLATION" ? "Submitting…" : "Defibrillate"}</Text></Pressable>
    </View>
    {result?.ok && <Text style={styles.success}>Command accepted; awaiting canonical snapshot.</Text>}
    {result && !result.ok && <Text style={styles.error}>{result.errorCode}: {result.message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff7ed", borderWidth: 1, borderColor: "#fdba74", borderRadius: 12, padding: 14, gap: 10 },
  title: { color: "#9a3412", fontSize: 18, fontWeight: "900" }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  label: { width: "42%", color: "#7c2d12", fontWeight: "700" }, value: { width: "52%", color: "#172b4d", fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8 }, button: { flex: 1, backgroundColor: "#005bbb", padding: 12, borderRadius: 10, alignItems: "center" },
  shock: { flex: 1, backgroundColor: "#b91c1c", padding: 12, borderRadius: 10, alignItems: "center" }, disabled: { opacity: 0.35 },
  buttonText: { color: "#fff", fontWeight: "900" }, success: { color: "#15803d", fontWeight: "700" }, error: { color: "#b91c1c", fontWeight: "700" },
});
