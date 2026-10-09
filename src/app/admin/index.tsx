import { router } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { signOutOperator } from "@/services/authorization/OperatorSessionService";
import RoleModeSwitcher from "@/components/RoleModeSwitcher";

export default function AdministrationScreen() {
  const signOut = () => void signOutOperator().then(() => router.replace("/"))
    .catch(() => Alert.alert("Väljalogimine ebaõnnestus", "Väljalogimine ei õnnestunud täielikult. Proovi uuesti."));
  return <ScrollView contentContainerStyle={styles.page}>
    <View><Text style={styles.kicker}>RussiCaptor</Text><Text style={styles.title}>Administratsioon</Text>
      <Text style={styles.subtitle}>Kasutajakontod ja õppusepõhised CM/EXCON rollid</Text></View>
    <RoleModeSwitcher />
    <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push("/admin/users")}>
      <Text style={styles.cardTitle}>Kasutajad</Text><Text style={styles.cardText}>Kutsu kasutajaid, lähtesta paroole ja halda konto olekut.</Text>
    </Pressable>
    <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push("/admin/exercises")}>
      <Text style={styles.cardTitle}>Õppused</Text><Text style={styles.cardText}>Loo õppusi ning määra või tühista õppusepõhiseid rolle.</Text>
    </Pressable>
    <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push("/admin/builder")}>
      <Text style={styles.cardTitle}>Exercise Builder</Text><Text style={styles.cardText}>Koosta uue õppusepaketi autorlussisu ja ekspordi see valideerimiseks.</Text>
    </Pressable>
    <Pressable accessibilityRole="button" style={styles.diagnostics} onPress={() => router.push("/excon/diagnostics" as never)}>
      <Text style={styles.diagnosticsTitle}>Tehnilised üksikasjad</Text><Text style={styles.cardText}>Tugiteave ja toetatud taastamistoimingud.</Text>
    </Pressable>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={signOut}><Text style={styles.secondaryText}>Logi välja</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#F6F8FB", padding: 24, gap: 16 },
  kicker: { color: "#005BBB", fontWeight: "800", marginTop: 12 }, title: { fontSize: 32, fontWeight: "900", color: "#101828" },
  subtitle: { color: "#475467", fontSize: 16, marginTop: 6 }, card: { padding: 20, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#D0D5DD" },
  cardTitle: { fontSize: 21, fontWeight: "800", color: "#101828" }, cardText: { color: "#475467", marginTop: 5, lineHeight: 21 },
  diagnostics: { padding: 16, backgroundColor: "#EAECF0", borderRadius: 12 }, diagnosticsTitle: { fontSize: 18, fontWeight: "800", color: "#344054" },
  secondary: { alignSelf: "flex-start", padding: 12 }, secondaryText: { color: "#B42318", fontWeight: "700" },
});
