import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { inviteAdminUser, listAdminUsers, requestAdminPasswordReset, setAdminUserActive, type AdminUser } from "@/services/admin/PlatformAdminService";
import { accountStatusLabel, assignmentStatusLabel, publicErrorMessage } from "@/localization/et";

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<readonly AdminUser[]>([]);
  const [email, setEmail] = useState(""); const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  const load = useCallback(async () => { try { setUsers(await listAdminUsers()); } catch (error) { setMessage(publicErrorMessage(error, "Kasutajate laadimine ebaõnnestus.")); } }, []);
  useEffect(() => {
    let active = true;
    void listAdminUsers().then(next => { if (active) setUsers(next); })
      .catch(error => { if (active) setMessage(publicErrorMessage(error, "Kasutajate laadimine ebaõnnestus.")); });
    return () => { active = false; };
  }, []);
  const perform = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setMessage(undefined);
    try { await operation(); setMessage(success); await load(); } catch (error) { setMessage(publicErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Administratsioon</Text></Pressable>
    <Text style={styles.title}>Kasutajad</Text>
    <View style={styles.panel}><Text style={styles.panelTitle}>Lisa kasutaja</Text>
      <TextInput accessibilityLabel="Kasutaja nimi" value={displayName} onChangeText={setDisplayName} placeholder="Nimi" style={styles.input} />
      <TextInput accessibilityLabel="Kasutaja e-post" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="E-post" style={styles.input} />
      <Pressable disabled={busy || !email.trim() || !displayName.trim()} style={[styles.primary, (busy || !email.trim() || !displayName.trim()) && styles.disabled]}
        onPress={() => void perform(() => inviteAdminUser(email, displayName), "Kutse saadetud.")}><Text style={styles.primaryText}>Saada kutse</Text></Pressable>
      <Text style={styles.note}>Kasutaja valib parooli turvalise kutselingi kaudu. Administraator parooli ei näe.</Text>
    </View>
    {message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    {users.map(user => <View key={user.userId} style={styles.panel}>
      <Text style={styles.panelTitle}>{user.displayName || "Kutse ootel"}</Text><Text style={styles.email}>{user.email}</Text>
      <Text style={styles.badge}>{accountStatusLabel(user.status)}</Text>
      <Text style={styles.meta}>{user.assignments.filter(item => item.status === "ACTIVE").map(item => `${item.role} · ${assignmentStatusLabel(item.status)} õppuseroll`).join("\n") || "Aktiivseid õppuserolle pole"}</Text>
      <View style={styles.row}>
        <Pressable disabled={busy} style={styles.outline} onPress={() => Alert.alert("Parooli lähtestamine", `Saada lähtestuslink aadressile ${user.email}?`, [
          { text: "Loobu", style: "cancel" }, { text: "Saada", onPress: () => void perform(() => requestAdminPasswordReset(user.email), "Lähtestuslink saadetud.") },
        ])}><Text style={styles.outlineText}>Lähtesta parool</Text></Pressable>
        <Pressable disabled={busy} style={styles.outline} onPress={() => Alert.alert(user.status === "DISABLED" ? "Aktiveeri konto" : "Deaktiveeri konto", user.status === "DISABLED" ? "Kas aktiveerida kasutaja konto?" : "Aktiivsed õppuserollid tühistatakse. Kui kasutaja juhib parajasti õppust, palutakse juhtimine enne turvaliselt üle anda.", [
          { text: "Loobu", style: "cancel" }, { text: "Kinnita", style: user.status === "DISABLED" ? "default" : "destructive", onPress: () => void perform(() => setAdminUserActive(user.userId, user.status === "DISABLED"), user.status === "DISABLED" ? "Konto aktiveeritud." : "Konto deaktiveeritud.") },
        ])}><Text style={styles.outlineText}>{user.status === "DISABLED" ? "Aktiveeri" : "Deaktiveeri"}</Text></Pressable>
      </View>
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#F6F8FB", padding: 20, gap: 14 }, back: { color: "#005BBB", fontWeight: "700" }, title: { fontSize: 30, fontWeight: "900", color: "#101828" },
  panel: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 14, padding: 16, gap: 9 }, panelTitle: { fontSize: 19, fontWeight: "800", color: "#101828" },
  input: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 9, padding: 12, fontSize: 16 }, primary: { backgroundColor: "#005BBB", padding: 13, borderRadius: 9, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "800" }, disabled: { opacity: 0.45 }, note: { color: "#667085", fontSize: 12, lineHeight: 17 }, message: { color: "#344054", fontWeight: "700" },
  email: { color: "#475467" }, badge: { alignSelf: "flex-start", backgroundColor: "#EAECF0", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, fontWeight: "700", color: "#344054" },
  meta: { color: "#475467", lineHeight: 20 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, outline: { borderWidth: 1, borderColor: "#005BBB", borderRadius: 8, padding: 10 }, outlineText: { color: "#005BBB", fontWeight: "700" },
});
