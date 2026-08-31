import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { assignPatientToMeConflictSafe, releasePatientConflictSafe } from "@/services/AssignmentRepository";
import {
  prepareSameBaseMutableMutation,
  prepareStaleFormerOwnerMutation,
  submitPreparedPhysicalValidationMutation,
  type PreparedPhysicalValidationMutation,
} from "@/services/sharedWorkflow/PhysicalValidationHarnessService";

const patientId = "PT-PELVIC-001";

export default function SharedWorkflowValidationCard() {
  const [prepared, setPrepared] = useState<PreparedPhysicalValidationMutation>();
  const [message, setMessage] = useState("Valideerimisrada on valmis.");
  const [pending, setPending] = useState(false);

  const run = async (operation: () => Promise<{ message: string }>) => {
    setPending(true);
    try { setMessage((await operation()).message); } finally { setPending(false); }
  };
  const stage = (kind: "stale" | "mutable") => {
    const next = kind === "stale"
      ? prepareStaleFormerOwnerMutation(patientId)
      : prepareSameBaseMutableMutation(patientId);
    if (!next) { setMessage("Proovi saab valmistada ainult patsiendi praegune omanik."); return; }
    setPrepared(next);
    setMessage(`Valmis: ${next.kind}, alusversioon ${next.expectedRevision}.`);
  };

  return <View style={styles.card}>
    <Text style={styles.title}>Ainult validation-build: jagatud töövoo race-test</Text>
    <Text style={styles.description}>Kasutab tavapärast autentitud kliendi RPC/CAS rada. Canonical release’is seda kaarti ei ole.</Text>
    <Pressable accessibilityLabel="Validation simultaneous claim" disabled={pending} style={styles.primary} onPress={() => void run(() => assignPatientToMeConflictSafe(patientId))}>
      <Text style={styles.primaryText}>Saada samaaegne CLAIM</Text>
    </Pressable>
    <Pressable accessibilityLabel="Validation release patient" disabled={pending} style={styles.secondary} onPress={() => void run(() => releasePatientConflictSafe(patientId))}>
      <Text style={styles.secondaryText}>Vabasta patsient puhtaks CLAIM-testiks</Text>
    </Pressable>
    <Pressable accessibilityLabel="Prepare stale former owner mutation" disabled={pending} style={styles.secondary} onPress={() => stage("stale")}>
      <Text style={styles.secondaryText}>Valmista aegunud omaniku mutatsioon</Text>
    </Pressable>
    <Pressable accessibilityLabel="Prepare same base mutable mutation" disabled={pending} style={styles.secondary} onPress={() => stage("mutable")}>
      <Text style={styles.secondaryText}>Valmista sama alusversiooni MUTABLE</Text>
    </Pressable>
    <Pressable accessibilityLabel="Submit prepared validation mutation" disabled={pending || !prepared} style={[styles.primary, !prepared && styles.disabled]} onPress={() => prepared && void run(() => submitPreparedPhysicalValidationMutation(prepared))}>
      <Text style={styles.primaryText}>Saada valmismutatsioon</Text>
    </Pressable>
    <Text accessibilityRole="alert" style={styles.message}>{message}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 560, marginTop: 20, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: "#B54708", backgroundColor: "#FFFAEB", gap: 10 },
  title: { color: "#7A2E0E", fontSize: 17, fontWeight: "700" },
  description: { color: "#7A2E0E", fontSize: 14 },
  primary: { padding: 13, alignItems: "center", borderRadius: 8, backgroundColor: "#B54708" },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: { padding: 12, alignItems: "center", borderRadius: 8, borderWidth: 1, borderColor: "#B54708" },
  secondaryText: { color: "#7A2E0E", fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.45 },
  message: { color: "#475467", fontSize: 14 },
});
