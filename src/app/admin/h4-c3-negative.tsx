import { useRef, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";
import { h4ProbeAvailability, runHistoricalInputProbe } from "@/diagnostics/h4c3/HistoricalInputProbe";
import type { H4Report } from "@/diagnostics/h4c3/HistoricalInputProbeCore";

export default function HistoricalInputNegativeScreen() {
  const operator = useOperatorSession();
  const [result, setResult] = useState<H4Report>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  if (!hasPlatformAdminAuthority(operator)) return <Text>Olemasolev administraatori seanss on nõutav. Õigusi ei lisata.</Text>;
  const unavailable = h4ProbeAvailability();
  const execute = async () => {
    if (inFlight.current || pending || result || h4ProbeAvailability()) return;
    inFlight.current = true;
    setPending(true);
    try { setResult(await runHistoricalInputProbe()); }
    catch { setError("BLOCKED: katse eeltingimus või täitmine ebaõnnestus. PASS-i ei väljastata."); }
    finally { setPending(false); }
  };
  return <ScrollView contentContainerStyle={{ padding: 28, gap: 18 }}>
    <Text style={{ fontSize: 26, fontWeight: "800" }}>H4 C3 — piiratud negatiivne seadmetest</Text>
    <Text>DIAGNOSTIC 187. Ei ole operatiivseks kasutuseks. Käivitub ainult eraldi vajutusega. Automaatset kordust pole.</Text>
    <Text>Täpne andmevaba offline-tulemus ja neli ajaloolist identiteeti. Olemasolevad kaitsed jäävad muutmata. Privaatset salvestust ei asendata; tootmispäringuid, rolli ega õppust ei looda.</Text>
    <Text>Identiteediga seotud projektsiooniproovid ei ole ajalooliste checkpoint-payload'ide koopiad.</Text>
    {unavailable && <Text accessibilityRole="alert">Eeltingimus: {unavailable}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Käivita üks H4 C3 negatiivne katse" disabled={pending || Boolean(unavailable) || Boolean(result)} onPress={() => void execute()} style={{ padding: 20, backgroundColor: unavailable || pending || result ? "#777" : "#005BBB" }}>
      <Text style={{ color: "white", fontWeight: "700" }}>{pending ? "Kontrollin…" : "Käivita üks H4 C3 negatiivne katse"}</Text>
    </Pressable>
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {result && <><Text accessibilityRole="alert">{result.status} · {result.cases.filter(x => x.status === "PASS").length}/{result.cases.length} · {result.reason ?? "Oleku muutust ei tuvastatud"}</Text><Text selectable>{JSON.stringify(result, null, 2)}</Text></>}
    <Pressable accessibilityRole="button" onPress={() => router.back()}><Text>Tagasi</Text></Pressable>
  </ScrollView>;
}
