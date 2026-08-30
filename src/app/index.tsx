import { router } from "expo-router";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";
import { getBuildProvenance, getReleaseConfigurationError } from "@/config/ReleaseConfig";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { signInOperator } from "@/services/authorization/OperatorSessionService";
import { resolveOperatorLandingRoute } from "@/services/ui/OperatorRouteService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

export default function LoginScreen() {
  const build = getBuildProvenance();
  const releaseConfigurationError = getReleaseConfigurationError();
  const operator = useOperatorSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (operator.state !== "AUTHENTICATED") return;
    router.replace(resolveOperatorLandingRoute(operator, getCanonicalExerciseSnapshot().exerciseId));
  }, [operator]);

  async function submit(): Promise<void> {
    if (releaseConfigurationError) { setError(releaseConfigurationError); return; }
    setSubmitting(true); setError(undefined);
    try {
      const result = await signInOperator(email, password);
      if (result.state === "UNAUTHORIZED") setError(result.message);
      else if (result.state === "UNAVAILABLE") setError(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sisselogimine ebaõnnestus."); }
    finally { setSubmitting(false); }
  }

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>RussiCaptor</Text>

      <Text style={styles.subtitle}>Õppuste juhtimise platvorm</Text>

      <Text style={styles.version}>Versioon {Constants.expoConfig?.version ?? "tundmatu"} ({build.versionCode})</Text>
      <Text style={styles.build}>Build {build.gitSha === "development" ? "arendus" : build.gitSha.slice(0, 12)} · {build.environment}</Text>
      {build.supabaseProjectRef && <Text style={styles.build}>Supabase {build.supabaseProjectRef}</Text>}
      {releaseConfigurationError && <Text accessibilityRole="alert" style={styles.error}>{releaseConfigurationError}</Text>}
      <TextInput accessibilityLabel="E-posti aadress" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="E-post" style={styles.input} />
      <TextInput accessibilityLabel="Parool" autoCapitalize="none" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Parool" style={styles.input} />
      {operator.state === "LOADING" && <ActivityIndicator />}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={Boolean(releaseConfigurationError) || submitting || !email.trim() || !password} style={[styles.button, (releaseConfigurationError || submitting || !email.trim() || !password) && styles.buttonDisabled]} onPress={() => void submit()}>
        <Text style={styles.buttonText}>{submitting ? "Kontrollin…" : "Logi sisse"}</Text>
      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "#ffffff",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 42,

    fontWeight: "bold",

    marginBottom: 12,

  },

  subtitle: {

    fontSize: 22,

    color: "#555",

    marginBottom: 6,

  },

  version: {

    fontSize: 16,

    color: "#888",

    marginBottom: 4,

  },
  build: { fontSize: 12, color: "#667085", marginBottom: 4 },

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    paddingHorizontal: 50,

    borderRadius: 12,

  },
  buttonDisabled: { opacity: 0.5 },
  input: { width: "100%", maxWidth: 380, borderWidth: 1, borderColor: "#98A2B3", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, marginBottom: 12 },
  error: { color: "#B42318", marginBottom: 12, textAlign: "center" },

  buttonText: {

    color: "#ffffff",

    fontWeight: "bold",

    fontSize: 18,

  },

});
