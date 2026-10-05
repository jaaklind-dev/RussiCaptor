import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { signOutOperator } from "@/services/authorization/OperatorSessionService";
import { type AuthSetupFlow, updateAuthenticatedPassword, validateNewPassword } from "@/services/auth/AuthCallbackService";
import { supabase } from "@/services/SupabaseService";
import { publicErrorMessage } from "@/localization/et";

export default function SetPasswordScreen() {
  const { flow } = useLocalSearchParams<{ flow?: AuthSetupFlow }>();
  const [checking, setChecking] = useState(Boolean(supabase));
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!supabase) return () => { mounted = false; };
    void supabase?.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      setSessionReady(!sessionError && Boolean(data.session) && (flow === "invite" || flow === "recovery"));
      setChecking(false);
    }).catch(() => { if (mounted) { setSessionReady(false); setChecking(false); } });
    return () => { mounted = false; };
  }, [flow]);

  async function submit(): Promise<void> {
    const validationError = validateNewPassword(password, confirmation);
    if (validationError) { setError(validationError); return; }
    setSubmitting(true); setError(undefined);
    try {
      await updateAuthenticatedPassword(password);
      setPassword(""); setConfirmation("");
      await signOutOperator();
      router.replace({ pathname: "/", params: { passwordUpdated: "1" } });
    } catch (cause) {
      setError(publicErrorMessage(cause, "Parooli ei saanud uuendada. Küsi uus paroolilink ja proovi uuesti."));
    } finally { setSubmitting(false); }
  }

  if (checking) return <View style={styles.container}><ActivityIndicator size="large" color="#005BBB" /><Text style={styles.message}>Kontrollin seanssi…</Text></View>;
  if (!sessionReady) return <View style={styles.container}>
    <Text style={styles.title}>Paroolilink ei kehti</Text>
    <Text accessibilityRole="alert" style={styles.error}>Seanss puudub või on aegunud. Palu administraatoril saata uus paroolilink.</Text>
  </View>;

  return <View style={styles.container}>
    <Text style={styles.title}>{flow === "invite" ? "Määra parool" : "Määra uus parool"}</Text>
    <Text style={styles.message}>Parool jääb ainult sinu ja autentimisteenuse teada.</Text>
    <TextInput accessibilityLabel="Uus parool" autoCapitalize="none" autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Uus parool" style={styles.input} />
    <TextInput accessibilityLabel="Korda uut parooli" autoCapitalize="none" autoComplete="new-password" secureTextEntry value={confirmation} onChangeText={setConfirmation} placeholder="Korda uut parooli" style={styles.input} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={submitting || !password || !confirmation} style={[styles.button, (submitting || !password || !confirmation) && styles.buttonDisabled]} onPress={() => void submit()}>
      <Text style={styles.buttonText}>{submitting ? "Salvestan…" : "Määra parool"}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F6F8FB" },
  title: { color: "#101828", fontSize: 28, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  message: { color: "#475467", fontSize: 16, marginBottom: 20, textAlign: "center" },
  input: { width: "100%", maxWidth: 420, borderWidth: 1, borderColor: "#98A2B3", borderRadius: 10, backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, marginBottom: 12 },
  error: { color: "#B42318", fontSize: 16, marginBottom: 14, textAlign: "center" },
  button: { backgroundColor: "#005BBB", borderRadius: 10, paddingHorizontal: 28, paddingVertical: 14 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
});
