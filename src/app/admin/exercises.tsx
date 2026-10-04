import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createAdminExercise } from "@/services/admin/PlatformAdminExerciseCreation";
import { grantExerciseRole, listAdminExercises, listAdminUsers, revokeExerciseRole, type AdminExercise, type AdminUser } from "@/services/admin/PlatformAdminService";
import { useOperatorSession } from "@/hooks/useOperatorSession";

export default function AdminExercisesScreen() {
  const operator = useOperatorSession(); const [exercises, setExercises] = useState<readonly AdminExercise[]>([]); const [users, setUsers] = useState<readonly AdminUser[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>(); const [selectedUser, setSelectedUser] = useState<string>(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  const [userSearch, setUserSearch] = useState("");
  const load = useCallback(async () => { try { const [nextExercises, nextUsers] = await Promise.all([listAdminExercises(), listAdminUsers()]); setExercises(nextExercises); setUsers(nextUsers); } catch (error) { setMessage(String(error)); } }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([listAdminExercises(), listAdminUsers()]).then(([nextExercises, nextUsers]) => {
      if (active) { setExercises(nextExercises); setUsers(nextUsers); }
    }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, []);
  const exercise = useMemo(() => exercises.find(item => item.exerciseId === selectedExercise), [exercises, selectedExercise]);
  const eligibleUsers = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase("et");
    if (query.length < 2) return [];
    return users.filter(user => user.status !== "DISABLED" &&
      `${user.displayName} ${user.email}`.toLocaleLowerCase("et").includes(query)).slice(0, 20);
  }, [userSearch, users]);
  const perform = async (action: () => Promise<void>, success: string) => { setBusy(true); setMessage(undefined); try { await action(); setMessage(success); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Toiming ebaõnnestus."); } finally { setBusy(false); } };
  const createExercise = async () => {
    if (operator.state !== "AUTHENTICATED") return;
    setBusy(true); setMessage(undefined);
    try { const exerciseId = await createAdminExercise(operator.profile.userId); setMessage(`Õppus ${exerciseId} loodud.`); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Õppuse loomine ebaõnnestus."); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Administratsioon</Text></Pressable><Text style={styles.title}>Õppused</Text>
    <Pressable style={styles.catalog} onPress={() => router.push("/excon/catalog")}><Text style={styles.catalogText}>Vali pakett</Text></Pressable>
    <Pressable disabled={busy} style={styles.primary} onPress={() => void createExercise()}><Text style={styles.primaryText}>Loo uus õppus</Text></Pressable>
    <Text style={styles.note}>Valitud aktiivne pakett valmistatakse uueks õppuseks olemasoleva bootstrap- ja kanoonilise ettevalmistusvooga.</Text>
    {message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    {exercise && <View style={styles.panel}><Text style={styles.panelTitle}>Osalejad · {exercise.exerciseId}</Text>
      {(exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED") && <Text style={styles.warning}>Terminalne õppus on kirjutuskaitstud.</Text>}
      <Text style={styles.label}>Vali kasutaja</Text>
      <TextInput accessibilityLabel="Otsi kasutajat" value={userSearch} onChangeText={value => { setUserSearch(value); setSelectedUser(undefined); }} placeholder="Nimi või e-post" autoCapitalize="none" style={styles.search} />
      {userSearch.trim().length < 2 && <Text style={styles.meta}>Sisesta vähemalt kaks tähemärki.</Text>}
      {userSearch.trim().length >= 2 && eligibleUsers.length === 0 && <Text style={styles.meta}>Sobivaid aktiivseid kasutajaid ei leitud.</Text>}
      <View style={styles.choices}>{eligibleUsers.map(user => <Pressable key={user.userId} onPress={() => setSelectedUser(user.userId)} style={[styles.choice, selectedUser === user.userId && styles.choiceSelected]}><Text style={styles.choiceText}>{user.displayName || user.email}</Text><Text style={styles.choiceEmail}>{user.email}</Text></Pressable>)}</View>
      <View style={styles.row}><Pressable disabled={busy || !selectedUser || exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED"} style={styles.outline} onPress={() => void perform(() => grantExerciseRole(selectedUser!, exercise.exerciseId, "CM"), "CM roll määratud.")}><Text style={styles.outlineText}>Lisa CM</Text></Pressable>
        <Pressable disabled={busy || !selectedUser || exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED"} style={styles.outline} onPress={() => void perform(() => grantExerciseRole(selectedUser!, exercise.exerciseId, "EXCON"), "EXCON roll määratud.")}><Text style={styles.outlineText}>Lisa EXCON</Text></Pressable></View>
      {exercise.assignments.map(assignment => <View key={assignment.id} style={styles.assignment}><Text style={styles.meta}>{users.find(user => user.userId === assignment.user_id)?.displayName || assignment.user_id} · {assignment.role} · {assignment.status}</Text>
        {assignment.status === "ACTIVE" && <Pressable onPress={() => Alert.alert("Tühista roll", "Runtime-omand või writer lease peatab tühistamise turvaliselt. Jätkata?", [{ text: "Loobu", style: "cancel" }, { text: "Tühista", style: "destructive", onPress: () => void perform(() => revokeExerciseRole(assignment), "Roll tühistatud.") }])}><Text style={styles.remove}>Tühista</Text></Pressable>}</View>)}
    </View>}
    {exercises.map(item => <Pressable key={item.exerciseId} style={[styles.panel, selectedExercise === item.exerciseId && styles.selected]} onPress={() => { setSelectedExercise(item.exerciseId); setSelectedUser(undefined); setUserSearch(""); }}>
      <Text style={styles.panelTitle}>{item.exerciseId}</Text><Text style={styles.meta}>{item.packageId ?? "Pakett määramata"}{item.packageVersion ? `@${item.packageVersion}` : ""} · {item.lifecycleState}</Text>
      <Text style={styles.meta}>{item.participantCount} osalejat · CM {item.cmCount} · EXCON {item.exconCount}</Text>
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#F6F8FB", padding: 20, gap: 12 }, back: { color: "#005BBB", fontWeight: "700" }, title: { fontSize: 30, fontWeight: "900", color: "#101828" },
  primary: { backgroundColor: "#005BBB", padding: 13, borderRadius: 9, alignItems: "center" }, primaryText: { color: "#fff", fontWeight: "800" }, note: { color: "#667085", fontSize: 12 },
  catalog: { borderWidth: 1, borderColor: "#005BBB", padding: 12, borderRadius: 9, alignItems: "center" }, catalogText: { color: "#005BBB", fontWeight: "800" },
  message: { color: "#344054", fontWeight: "700" }, panel: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 14, padding: 15, gap: 8 }, selected: { borderColor: "#005BBB", borderWidth: 2 },
  panelTitle: { fontWeight: "800", fontSize: 18, color: "#101828" }, meta: { color: "#475467" }, warning: { color: "#B42318", fontWeight: "800" }, label: { color: "#344054", fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }, choiceSelected: { borderColor: "#005BBB", backgroundColor: "#EFF8FF" }, choiceText: { color: "#344054", fontWeight: "600" },
  choiceEmail: { color: "#667085", fontSize: 11 }, search: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: "#101828" },
  row: { flexDirection: "row", gap: 9 }, outline: { borderWidth: 1, borderColor: "#005BBB", borderRadius: 8, padding: 10 }, outlineText: { color: "#005BBB", fontWeight: "700" }, assignment: { borderTopWidth: 1, borderTopColor: "#EAECF0", paddingTop: 9, flexDirection: "row", justifyContent: "space-between", gap: 10 }, remove: { color: "#B42318", fontWeight: "700" },
});
