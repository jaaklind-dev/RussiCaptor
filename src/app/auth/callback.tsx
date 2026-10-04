import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

const messages: Readonly<Record<string, string>> = Object.freeze({
  EXPIRED_OR_INVALID: "Link on aegunud või juba kasutatud. Palu administraatoril saata uus paroolilink.",
  MALFORMED: "Autentimislink ei ole kehtiv.",
  MISSING_SESSION: "Autentimisseanssi ei leitud. Palu saata uus paroolilink.",
  NETWORK: "Autentimist ei saanud võrguühenduse tõttu lõpule viia. Proovi linki uuesti.",
});

export default function AuthCallbackScreen() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const message = status ? messages[status] ?? "Autentimist ei saanud lõpule viia." : undefined;
  return <View style={styles.container}>
    {!message && <ActivityIndicator accessibilityLabel="Autentimislingi kontrollimine" size="large" color="#005BBB" />}
    <Text style={styles.title}>{message ? "Link ei tööta" : "Kontrollin turvalist linki"}</Text>
    <Text accessibilityRole={message ? "alert" : undefined} style={message ? styles.error : styles.message}>
      {message ?? "Palun oota…"}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24, backgroundColor: "#F6F8FB" },
  title: { color: "#101828", fontSize: 24, fontWeight: "700", textAlign: "center" },
  message: { color: "#475467", fontSize: 16, textAlign: "center" },
  error: { color: "#B42318", fontSize: 16, textAlign: "center" },
});
