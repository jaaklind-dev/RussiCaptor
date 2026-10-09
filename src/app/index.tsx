import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/AppHeader";
import { getBuildProvenance, getReleaseConfigurationError } from "@/config/ReleaseConfig";
import { publicErrorMessage } from "@/localization/et";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { signInOperator } from "@/services/authorization/OperatorSessionService";
import { resolveSelectedModeNavigationTarget } from "@/services/ui/OperatorRouteService";
import { reconcileOperatorMode } from "@/services/ui/OperatorModeService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getSyncVersion, subscribeToSync } from "@/services/SyncService";

export default function LoginScreen() {
  const { passwordUpdated } = useLocalSearchParams<{ passwordUpdated?: string }>();
  const build = getBuildProvenance();
  const releaseConfigurationError = getReleaseConfigurationError();
  const operator = useOperatorSession();
  const syncVersion = useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (operator.state !== "AUTHENTICATED") return;
    const mode = reconcileOperatorMode(operator).selectedMode;
    const target = resolveSelectedModeNavigationTarget(operator, mode, getCanonicalExerciseSnapshot().exerciseId);
    if (target) router.replace(target);
  }, [operator, syncVersion]);

  async function submit(): Promise<void> {
    if (releaseConfigurationError) { setError("Rakenduse seadistus pole valmis. Võta ühendust administraatoriga."); return; }
    setSubmitting(true); setError(undefined);
    try {
      const result = await signInOperator(email, password);
      if (result.state === "UNAUTHORIZED") setError(result.message);
      else if (result.state === "UNAVAILABLE") setError("Sisselogimisteenus pole praegu saadaval. Proovi hiljem uuesti.");
    } catch (cause) { setError(publicErrorMessage(cause, "Sisselogimine ebaõnnestus.")); }
    finally { setSubmitting(false); }
  }

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>RussiCaptor</Text>

      <Text style={styles.subtitle}>Õppuste juhtimise platvorm</Text>

      <Text style={styles.version}>Versioon {Constants.expoConfig?.version ?? "tundmatu"} · järk {build.versionCode}</Text>
      {releaseConfigurationError && <Text accessibilityRole="alert" style={styles.error}>Rakenduse seadistus pole valmis. Võta ühendust administraatoriga.</Text>}
      {passwordUpdated === "1" && <Text accessibilityLiveRegion="polite" style={styles.success}>Parool on uuendatud. Logi uue parooliga sisse.</Text>}
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

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    paddingHorizontal: 50,

    borderRadius: 12,

  },
  buttonDisabled: { opacity: 0.5 },
  input: { width: "100%", maxWidth: 380, borderWidth: 1, borderColor: "#98A2B3", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, marginBottom: 12 },
  error: { color: "#B42318", marginBottom: 12, textAlign: "center" },
  success: { color: "#067647", marginBottom: 12, textAlign: "center" },

  buttonText: {

    color: "#ffffff",

    fontWeight: "bold",

    fontSize: 18,

  },

});
