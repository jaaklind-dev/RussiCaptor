import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { grantExerciseRole, listAdminExercises, listAdminUsers, revokeExerciseRole, type AdminExercise, type AdminUser } from "@/services/admin/PlatformAdminService";
import { refreshOperatorSession } from "@/services/authorization/OperatorSessionService";
import { useOperatorSession } from "@/hooks/useOperatorSession";
import { assignmentStatusLabel, exerciseLifecycleLabel, exercisePackageIdLabel, publicErrorMessage } from "@/localization/et";

export default function AdminExercisesScreen() {
  const { createdExerciseId } = useLocalSearchParams<{ createdExerciseId?: string }>();
  const operator = useOperatorSession();
  const adminReady = operator.state === "AUTHENTICATED" && operator.isPlatformAdmin === true;
  const [exercises, setExercises] = useState<readonly AdminExercise[]>(); const [users, setUsers] = useState<readonly AdminUser[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>(); const [selectedUser, setSelectedUser] = useState<string>(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false); const [listError, setListError] = useState<string>(); const [usersError, setUsersError] = useState<string>();
  const [userSearch, setUserSearch] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!adminReady) return;
    const request = ++generation.current;
    setLoading(true);
    setListError(undefined);
    setUsersError(undefined);
    // User enrichment is independent: its failure must not erase a valid exercise list.
    const [exerciseResult, userResult] = await Promise.allSettled([listAdminExercises(), listAdminUsers()]);
    if (request !== generation.current) return;
    if (exerciseResult.status === "fulfilled") setExercises(exerciseResult.value);
    else setListError(publicErrorMessage(exerciseResult.reason, "Õppuste laadimine ebaõnnestus."));
    if (userResult.status === "fulfilled") setUsers(userResult.value);
    else setUsersError("Kasutajate laadimine ebaõnnestus. Proovi uuesti.");
    setLoading(false);
  }, [adminReady]);
  useEffect(() => {
    let active = true;
    if (adminReady) void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; generation.current += 1; };
  }, [adminReady, load]);
  const visibleExercises = useMemo(() => exercises ?? [], [exercises]);
  const createdExercise = useMemo(() => createdExerciseId ? visibleExercises.find(item => item.exerciseId === createdExerciseId) : undefined, [createdExerciseId, visibleExercises]);
  const effectiveSelectedExercise = selectedExercise ?? createdExercise?.exerciseId;
  const exercise = useMemo(() => visibleExercises.find(item => item.exerciseId === effectiveSelectedExercise), [effectiveSelectedExercise, visibleExercises]);
  const eligibleUsers = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase("et");
    if (query.length < 2) return [];
    return users.filter(user => user.status !== "DISABLED" &&
      `${user.displayName} ${user.email}`.toLocaleLowerCase("et").includes(query)).slice(0, 20);
  }, [userSearch, users]);
  const perform = async (action: () => Promise<void>, success: string) => { setBusy(true); setMessage(undefined); try { await action(); setMessage(success); await refreshOperatorSession(); await load(); } catch (error) { setMessage(publicErrorMessage(error)); } finally { setBusy(false); } };
  const displayMessage = message ?? (createdExercise ? "Uus õppus on loodud." : undefined);
  if (operator.state === "LOADING") return <View style={styles.page}><Text>Laadin kasutajaõigusi…</Text></View>;
  if (!adminReady) return <View style={styles.page}><Text accessibilityRole="alert">Administraatori õigused pole saadaval.</Text></View>;
  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Administratsioon</Text></Pressable><Text style={styles.title}>Õppused</Text>
    <Pressable style={styles.primary} onPress={() => router.push("/admin/package-selection")}><Text style={styles.primaryText}>Loo uus õppus</Text></Pressable>
    <Text style={styles.note}>Vali pakett ja kinnita selle põhjal uue õppuse loomine.</Text>
    {displayMessage && <Text accessibilityRole="alert" style={styles.message}>{displayMessage}</Text>}
    {loading && <Text testID="admin-exercises-loading" style={styles.meta}>{exercises ? "Uuendan õppusi…" : "Laadin õppusi…"}</Text>}
    {listError && <Text testID="admin-exercises-error" accessibilityRole="alert" style={styles.message}>{exercises ? "Õppuste värskendamine ebaõnnestus. Varasem nimekiri on endiselt nähtav." : listError}</Text>}
    {usersError && <Text testID="admin-exercises-users-error" accessibilityRole="alert" style={styles.message}>{usersError}</Text>}
    {(listError || usersError || exercises) && <Pressable testID="admin-exercises-retry" accessibilityRole="button" disabled={loading} onPress={() => void load()}><Text style={styles.back}>{loading ? "Uuendan…" : "Värskenda nimekirja"}</Text></Pressable>}
    {exercise && <View style={styles.panel}><Text style={styles.panelTitle}>Osalejad · {exercisePackageIdLabel(exercise.packageId)}</Text>
      {(exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED") && <Text style={styles.warning}>Terminalne õppus on kirjutuskaitstud.</Text>}
      <Text style={styles.label}>Vali kasutaja</Text>
      <TextInput accessibilityLabel="Otsi kasutajat" value={userSearch} onChangeText={value => { setUserSearch(value); setSelectedUser(undefined); }} placeholder="Nimi või e-post" autoCapitalize="none" style={styles.search} />
      {userSearch.trim().length < 2 && <Text style={styles.meta}>Sisesta vähemalt kaks tähemärki.</Text>}
      {userSearch.trim().length >= 2 && eligibleUsers.length === 0 && <Text style={styles.meta}>Sobivaid aktiivseid kasutajaid ei leitud.</Text>}
      <View style={styles.choices}>{eligibleUsers.map(user => <Pressable key={user.userId} onPress={() => setSelectedUser(user.userId)} style={[styles.choice, selectedUser === user.userId && styles.choiceSelected]}><Text style={styles.choiceText}>{user.displayName || user.email}</Text><Text style={styles.choiceEmail}>{user.email}</Text></Pressable>)}</View>
      <View style={styles.row}><Pressable disabled={busy || !selectedUser || exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED"} style={styles.outline} onPress={() => void perform(() => grantExerciseRole(selectedUser!, exercise.exerciseId, "CM"), "CM roll määratud.")}><Text style={styles.outlineText}>Lisa CM</Text></Pressable>
        <Pressable disabled={busy || !selectedUser || exercise.lifecycleState === "COMPLETED" || exercise.lifecycleState === "TERMINATED"} style={styles.outline} onPress={() => void perform(() => grantExerciseRole(selectedUser!, exercise.exerciseId, "EXCON"), "EXCON roll määratud.")}><Text style={styles.outlineText}>Lisa EXCON</Text></Pressable></View>
      {exercise.assignments.map(assignment => <View key={assignment.id} style={styles.assignment}><Text style={styles.meta}>{users.find(user => user.userId === assignment.user_id)?.displayName || "Tundmatu kasutaja"} · {assignment.role} · {assignmentStatusLabel(assignment.status)}</Text>
        {assignment.status === "ACTIVE" && <Pressable onPress={() => Alert.alert("Tühista roll", "Kui kasutaja juhib parajasti õppust, tuleb juhtimine enne turvaliselt üle anda. Jätkata?", [{ text: "Loobu", style: "cancel" }, { text: "Tühista", style: "destructive", onPress: () => void perform(() => revokeExerciseRole(assignment), "Roll tühistatud.") }])}><Text style={styles.remove}>Tühista</Text></Pressable>}</View>)}
    </View>}
    {visibleExercises.map(item => <Pressable key={item.exerciseId} testID={`admin-exercise-${item.exerciseId}`} style={[styles.panel, effectiveSelectedExercise === item.exerciseId && styles.selected]} onPress={() => { setSelectedExercise(item.exerciseId); setSelectedUser(undefined); setUserSearch(""); }}>
      <Text style={styles.panelTitle}>{exercisePackageIdLabel(item.packageId)}</Text><Text style={styles.meta}>{item.packageVersion ? `Versioon ${item.packageVersion} · ` : ""}{exerciseLifecycleLabel(item.lifecycleState)}</Text>
      <Text style={styles.meta}>{item.participantCount} osalejat · CM {item.cmCount} · EXCON {item.exconCount}</Text>
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#F6F8FB", padding: 20, gap: 12 }, back: { color: "#005BBB", fontWeight: "700" }, title: { fontSize: 30, fontWeight: "900", color: "#101828" },
  primary: { backgroundColor: "#005BBB", padding: 13, borderRadius: 9, alignItems: "center" }, primaryText: { color: "#fff", fontWeight: "800" }, note: { color: "#667085", fontSize: 12 },
  message: { color: "#344054", fontWeight: "700" }, panel: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 14, padding: 15, gap: 8 }, selected: { borderColor: "#005BBB", borderWidth: 2 },
  panelTitle: { fontWeight: "800", fontSize: 18, color: "#101828" }, meta: { color: "#475467" }, warning: { color: "#B42318", fontWeight: "800" }, label: { color: "#344054", fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }, choiceSelected: { borderColor: "#005BBB", backgroundColor: "#EFF8FF" }, choiceText: { color: "#344054", fontWeight: "600" },
  choiceEmail: { color: "#667085", fontSize: 11 }, search: { borderWidth: 1, borderColor: "#98A2B3", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: "#101828" },
  row: { flexDirection: "row", gap: 9 }, outline: { borderWidth: 1, borderColor: "#005BBB", borderRadius: 8, padding: 10 }, outlineText: { color: "#005BBB", fontWeight: "700" }, assignment: { borderTopWidth: 1, borderTopColor: "#EAECF0", paddingTop: 9, flexDirection: "row", justifyContent: "space-between", gap: 10 }, remove: { color: "#B42318", fontWeight: "700" },
});
