import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { releasePatientConflictSafe } from "@/services/AssignmentRepository";
import { armPhysicalValidationHarness, disarmPhysicalValidationHarness, getPhysicalValidationEvidence, isPhysicalValidationContextArmed,
  prepareValidationClaim, prepareSameBaseAppendPair, prepareSameBaseMutableMutation, prepareStaleFormerOwnerMutation,
  canArmPhysicalValidationHarness, getPreparedValidationAvailability, subscribePhysicalValidationContext,
  submitNegativePhysicalValidationMutation, submitPreparedPhysicalValidationMutation, type PreparedPhysicalValidationMutation } from "@/services/sharedWorkflow/PhysicalValidationHarnessService";
import { getSharedWorkflowOperationalState, subscribeToSharedWorkflowConflicts } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const patientId = "PT-PELVIC-001";
function HarnessAction({ label, disabled, onPress }: Readonly<{ label: string; disabled: boolean; onPress(): void }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    style={[styles.button, disabled && styles.disabled]} onPress={() => { if (!disabled) onPress(); }}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export default function SharedWorkflowValidationCard({ readOnly = false }: Readonly<{ readOnly?: boolean }>) {
  const [workflow, setWorkflow] = useState(getSharedWorkflowOperationalState);
  const [prepared, setPrepared] = useState<readonly PreparedPhysicalValidationMutation[]>([]);
  const [message, setMessage] = useState("Armeeri ainult lubatud tehniline TEST-õppus."), [pending, setPending] = useState(false);
  const [evidence, setEvidence] = useState(getPhysicalValidationEvidence);
  const [, refresh] = useState(0);
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; const update = () => {
    setWorkflow(getSharedWorkflowOperationalState()); setEvidence(getPhysicalValidationEvidence());
    refresh(value => value + 1);
  }; const stop = subscribeToSharedWorkflowConflicts(update), stopContext = subscribePhysicalValidationContext(update);
  return () => { mounted.current = false; stop(); stopContext(); disarmPhysicalValidationHarness(); }; }, []);
  const run = async (operation: () => Promise<{ message: string }>) => {
    if (!mounted.current || readOnlyRef.current || busy.current) return;
    busy.current = true; setPending(true);
    try { const outcome = await operation(); if (mounted.current) setMessage(outcome.message); }
    catch { if (mounted.current) setMessage("Vastus on ebaselge. Säilita käsu ID; uut käsku ei looda."); }
    finally { busy.current = false; if (mounted.current) { setPending(false); setEvidence(getPhysicalValidationEvidence()); } }
  };
  const arm = (client: "Samsung-A" | "Samsung-B") => {
    if (readOnlyRef.current || busy.current || !canArmPhysicalValidationHarness()) return;
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    Alert.alert("Ainult lubatud TEST", `${exerciseId} · ${client}. Kinnita eraldi volitatud runtime-continuity TEST. See ei anna õigusi.`, [
      { text: "Loobu", style: "cancel" }, { text: "Kinnitan TEST", onPress: () => {
        if (!mounted.current || readOnlyRef.current || busy.current || getCanonicalExerciseSnapshot().exerciseId !== exerciseId) return;
        setPrepared([]); setMessage(armPhysicalValidationHarness(client) ? "TEST-kontekst seotud. Valmista käsk." : "Armeerimine keelatud: kontrolli build’i, paketti, CM-scope’i ja ühendust.");
        setEvidence(getPhysicalValidationEvidence());
      } },
    ]);
  };
  const stage = (kind: "claim" | "stale" | "append" | "mutable") => {
    if (readOnlyRef.current || busy.current || !isPhysicalValidationContextArmed()) return;
    const one = kind === "claim" ? prepareValidationClaim : kind === "stale" ? prepareStaleFormerOwnerMutation : prepareSameBaseMutableMutation;
    const next = kind === "append" ? prepareSameBaseAppendPair(patientId) : (() => { const p = one(patientId); return p ? [p] : undefined; })();
    setPrepared(next ?? []); setMessage(next ? "Valmiskäsud ei ole veel saadetud." : "Ettevalmistus keelatud: TEST-kontekst, omanik või autoriteetne alus puudub.");
  };
  const send = (p: PreparedPhysicalValidationMutation, negative = false) => {
    if (!mounted.current || readOnlyRef.current || busy.current) return;
    const availability = getPreparedValidationAvailability(p);
    if (!(negative ? availability.negative : availability.normal)) return;
    if (!negative) { void run(() => submitPreparedPhysicalValidationMutation(p)); return; }
    Alert.alert("Negatiivne TEST-käsk", `${p.commandId} · alus ${p.expectedRevision}. Saadan muutumatu aegunud MUTABLE-käsu ÜKS KORD, et tõendada serveri CAS-tagasilükkamist. Korduskatseid ei tehta. Ootamatu vastus nõuab STOP-i.`, [
      { text: "Loobu", style: "cancel" }, { text: "Kinnitan negatiivse TEST-i", onPress: () => {
        if (!mounted.current || readOnlyRef.current || busy.current || !getPreparedValidationAvailability(p).negative) return;
        void run(() => submitNegativePhysicalValidationMutation(p));
      } },
    ]);
  };
  const disabled = pending || readOnly;
  return <View style={styles.card}>
    <Text style={styles.title}>Ainult validation-build: jagatud töövoo race-test</Text>
    <Text>Üks auditeeritav TEST-kontekst; tavaline autentitud RPC/CAS. Canonical release’is seda kaarti ei ole.</Text>
    <Text>Workflow Realtime: {workflow.realtimeLifecycle} · hüdreeritud: {workflow.online ? "jah" : "ei"}</Text>
    {readOnly && <Text accessibilityRole="alert">Õppus on lõpetatud · ainult lugemiseks</Text>}
    <HarnessAction label="Armeeri TEST: Samsung-A" onPress={() => arm("Samsung-A")} disabled={disabled || !canArmPhysicalValidationHarness()} />
    <HarnessAction label="Armeeri TEST: Samsung-B" onPress={() => arm("Samsung-B")} disabled={disabled || !canArmPhysicalValidationHarness()} />
    <HarnessAction label="Valmista samaaegne CLAIM" onPress={() => stage("claim")} disabled={disabled || !isPhysicalValidationContextArmed() || !workflow.online} />
    <HarnessAction label="Vabasta patsient puhtaks CLAIM-testiks" onPress={() => {
      if (!isPhysicalValidationContextArmed()) { setMessage("Armeeri TEST kõigepealt."); return; }
      void run(() => releasePatientConflictSafe(patientId));
    }} disabled={disabled || !isPhysicalValidationContextArmed() || !workflow.online} />
    <HarnessAction label="Valmista aegunud omaniku mutatsioon" onPress={() => stage("stale")} disabled={disabled || !isPhysicalValidationContextArmed() || !workflow.online} />
    <HarnessAction label="Valmista sama baasiga APPEND-paar" onPress={() => stage("append")} disabled={disabled || !isPhysicalValidationContextArmed() || !workflow.online} />
    <HarnessAction label="Valmista sama alusversiooni MUTABLE" onPress={() => stage("mutable")} disabled={disabled || !isPhysicalValidationContextArmed() || !workflow.online} />
    {prepared.map((p, i) => <View key={p.commandId}>
      <Text selectable>{p.kind} · {p.commandId} · {p.exerciseId} · {p.patientId} · alus {p.expectedRevision}</Text>
      <HarnessAction label={`Saada valmiskäsk ${i + 1}`} onPress={() => send(p)} disabled={disabled || !getPreparedValidationAvailability(p).normal} />
      <HarnessAction label={`Negatiivne TEST-käsk ${i + 1}`} onPress={() => send(p, true)} disabled={disabled || !getPreparedValidationAvailability(p).negative} />
    </View>)}
    <Text accessibilityRole="alert">{message}</Text>
    <Text selectable>{JSON.stringify(evidence, null, 2)}</Text>
    <HarnessAction label="Jaga piiratud valideerimistõendit" disabled={disabled} onPress={() => void Share.share({ title: "WP-NEXT-03 TEST", message: JSON.stringify(getPhysicalValidationEvidence(), null, 2) })} />
  </View>;
}
const styles = StyleSheet.create({ card: { width: "100%", maxWidth: 560, marginTop: 20, padding: 16, gap: 12, borderWidth: 2, borderColor: "#B54708", backgroundColor: "#FFFAEB" },
  title: { fontWeight: "700", fontSize: 17 }, button: { minHeight: 48, padding: 14, backgroundColor: "#7A2E0E", borderRadius: 8 }, buttonText: { color: "white", fontWeight: "800" }, disabled: { opacity: 0.4 } });
