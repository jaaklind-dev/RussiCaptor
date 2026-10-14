import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  captureC11StaleWriterProbe,
  getC11StaleWriterProbeCapture,
  isC11StaleWriterProbeEnabled,
  sendC11StaleWriterProbe,
} from "@/services/runtime/persistence/C11StaleWriterAcceptanceProbe";
import { getRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { subscribeToRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";

function subscribeToWriterAuthority(onChange: () => void): () => void {
  return subscribeToRuntimeCheckpointSync(() => onChange());
}

/** Only mounted in a non-distributable acceptance build, under the EXCON route gate. */
export default function C11StaleWriterAcceptanceControls() {
  if (!isC11StaleWriterProbeEnabled()) return null;
  return <EnabledC11StaleWriterAcceptanceControls />;
}

function EnabledC11StaleWriterAcceptanceControls() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string>();
  const authority = useSyncExternalStore(subscribeToWriterAuthority,
    getRuntimeWriterAuthorityState, getRuntimeWriterAuthorityState);

  const capture = getC11StaleWriterProbeCapture();
  const run = async (operation: () => Promise<{ code: string; httpStatus?: number }>) => {
    if (pending) return;
    setPending(true);
    try {
      const outcome = await operation();
      setResult(`${outcome.code} · HTTP ${outcome.httpStatus ?? "–"}`);
    } catch {
      setResult("PROBE_UNEXPECTED_ERROR");
    } finally {
      setPending(false);
    }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>C11 ainult testkoostes: serveri writer-tõke</Text>
    <Text style={styles.warning}>Ainult kontrollitud TEST-õppuse jaoks. Salvesta A writer enne B ülevõtmist; saada täpselt üks muutmata olekuga päring pärast B avaldamist.</Text>
    {!capture && <Pressable accessibilityRole="button" style={[styles.button, (pending || authority !== "WRITER") && styles.disabled]}
      disabled={pending || authority !== "WRITER"}
      onPress={() => void run(captureC11StaleWriterProbe)}><Text style={styles.buttonText}>Salvesta selle seadme writer</Text></Pressable>}
    {capture && !capture.sent && <Pressable accessibilityRole="button" style={[styles.button, pending && styles.disabled]}
      disabled={pending} onPress={() => void run(sendC11StaleWriterProbe)}><Text style={styles.buttonText}>Saada üks vana writer’i testpäring</Text></Pressable>}
    {result && <Text selectable style={styles.result}>{result}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, marginTop: 18, backgroundColor: "#fef3f2", borderRadius: 12, borderWidth: 1, borderColor: "#fecdca" },
  title: { color: "#912018", fontSize: 18, fontWeight: "800" },
  warning: { color: "#912018", marginTop: 8 },
  button: { marginTop: 12, minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: "#175cd3", borderRadius: 10, paddingHorizontal: 12 },
  buttonText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.5 },
  result: { color: "#912018", fontWeight: "700", marginTop: 10 },
});
