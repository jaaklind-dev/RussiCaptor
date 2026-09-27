import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { useRuntimePatientCommandSubmissionReadiness } from
  "@/services/runtime/commands/useRuntimePatientCommandSubmissionReadiness";
import { getPatientTransportVersion, subscribeToPatientTransport } from
  "@/services/runtime/exercise/PatientTransportRuntimeService";
import { createPatientInternalTransferCommandId, getAvailablePatientInternalTransfers,
  submitPatientInternalTransfer } from "@/services/runtime/exercise/PatientInternalTransferService";

export function PatientInternalTransferControls({ patientId, readOnly = false }:
  { patientId: string; readOnly?: boolean }) {
  useSyncExternalStore(subscribeToPatientTransport, getPatientTransportVersion, getPatientTransportVersion);
  const exercise = getCanonicalExerciseSnapshot();
  const readiness = useRuntimePatientCommandSubmissionReadiness(exercise.exerciseId);
  const definitions = getAvailablePatientInternalTransfers(exercise.exerciseId, patientId);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const inFlight = useRef(false);
  if (definitions.length === 0) return null;
  const submit = async (actionId: string) => {
    if (inFlight.current || !readiness.ready) return;
    inFlight.current = true; setPending(true); setFeedback("Üleviimine käivitamisel…");
    try {
      const commandId = createPatientInternalTransferCommandId(exercise.exerciseId, patientId, actionId);
      const result = await submitPatientInternalTransfer(commandId, patientId, actionId);
      setFeedback(result.status === "REJECTED" ? "Üleviimist ei saanud alustada" : "Üleviimine käivitati");
    } finally { setPending(false); inFlight.current = false; }
  };
  const disabled = pending || !readiness.ready;
  return <View style={styles.card}><Text style={styles.title}>Patsiendi üleviimine</Text>
    {!readOnly && definitions.map(item => <Pressable key={item.actionId} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={() => void submit(item.actionId)}>
      <Text style={styles.buttonText}>{readiness.ready ? item.displayName : "Patsiendi andmeid sünkroniseeritakse…"}</Text>
    </Pressable>)}{!!feedback && <Text>{feedback}</Text>}</View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#eef4ff", borderRadius: 12, padding: 14,
  marginBottom: 14, gap: 7 }, title: { fontSize: 18, fontWeight: "700" }, button: { backgroundColor: "#175cd3",
  padding: 12, borderRadius: 9 }, disabled: { opacity: 0.45 }, buttonText: { color: "white", fontWeight: "700",
  textAlign: "center" } });
