import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useOperatorSession } from "@/hooks/useOperatorSession";
import { exercisePackageNameLabel, publicErrorMessage } from "@/localization/et";
import { resolveAdminPackageSelection, type AdminPackageRouteInput } from "@/services/admin/AdminPackageSelectionService";
import {
  createAdminExercise,
  createAdminExerciseOperationId,
  discardAdminExerciseCreationOperation,
} from "@/services/admin/PlatformAdminExerciseCreation";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";

export default function AdminExerciseCreateScreen({ routeInput }: Readonly<{ routeInput: AdminPackageRouteInput }>) {
  const operator = useOperatorSession();
  const resolution = resolveAdminPackageSelection(routeInput, exercisePackageRegistry);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const operationId = useRef(createAdminExerciseOperationId()).current;
  const submission = useRef<Promise<string> | undefined>(undefined);

  const create = async () => {
    if (!resolution.ok || operator.state !== "AUTHENTICATED") return;
    if (submission.current) return;
    setBusy(true); setMessage(undefined);
    try {
      const pending = createAdminExercise(operator.profile.userId, resolution.identity, operationId);
      submission.current = pending;
      const exerciseId = await pending;
      router.replace({ pathname: "/admin/exercises", params: { createdExerciseId: exerciseId } });
    } catch (error) {
      setMessage(publicErrorMessage(error, "Õppuse loomine ebaõnnestus."));
    } finally {
      submission.current = undefined;
      setBusy(false);
    }
  };

  if (!resolution.ok) return <View style={styles.centered}>
    <Text accessibilityRole="alert" style={styles.error}>{resolution.message}</Text>
    <Pressable accessibilityRole="button" onPress={() => router.replace("/admin/package-selection")} style={styles.primary} testID="admin-package-invalid-reselect">
      <Text style={styles.primaryText}>Vali pakett uuesti</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.replace("/admin/exercises")} style={styles.cancel} testID="admin-package-invalid-cancel">
      <Text style={styles.cancelText}>Tagasi õppuste juurde</Text>
    </Pressable>
  </View>;

  const pkg = resolution.package;
  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { discardAdminExerciseCreationOperation(operationId); router.back(); }} testID="admin-package-create-back"><Text style={styles.back}>‹ Vali teine pakett</Text></Pressable>
    <Text style={styles.title}>Loo uus õppus</Text>
    <View style={styles.card} testID="admin-selected-package">
      <Text style={styles.label}>Valitud õppusepakett</Text>
      <Text style={styles.name}>{exercisePackageNameLabel(pkg.metadata.name)}</Text>
      <Text style={styles.version}>Versioon {pkg.packageVersion}</Text>
      <Text style={styles.description}>{pkg.metadata.description}</Text>
    </View>
    <Text style={styles.note}>Õppus luuakse täpselt selle paketi ja versiooni põhjal. Rollid määratakse pärast loomist eraldi.</Text>
    {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void create()} style={[styles.primary, busy && styles.disabled]} testID="admin-create-selected-package">
      <Text style={styles.primaryText}>{busy ? "Loon õppust…" : "Loo õppus"}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { discardAdminExerciseCreationOperation(operationId); router.replace("/admin/exercises"); }} style={styles.cancel} testID="admin-package-create-cancel">
      <Text style={styles.cancelText}>Loobu</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#F6F8FB", padding: 20, paddingBottom: 40, gap: 14 },
  centered: { backgroundColor: "#F6F8FB", flex: 1, gap: 14, justifyContent: "center", padding: 24 },
  back: { color: "#005BBB", fontWeight: "700" },
  title: { color: "#101828", fontSize: 30, fontWeight: "900" },
  card: { backgroundColor: "#fff", borderColor: "#D0D5DD", borderRadius: 14, borderWidth: 1, gap: 7, padding: 16 },
  label: { color: "#475467", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  name: { color: "#101828", fontSize: 22, fontWeight: "900" },
  version: { color: "#344054", fontWeight: "700" },
  description: { color: "#475467", lineHeight: 20 },
  note: { color: "#667085", fontSize: 12, lineHeight: 18 },
  error: { color: "#B42318", fontWeight: "700" },
  primary: { alignItems: "center", backgroundColor: "#005BBB", borderRadius: 9, padding: 13 },
  primaryText: { color: "#fff", fontWeight: "900" },
  disabled: { opacity: 0.6 },
  cancel: { alignItems: "center", borderColor: "#98A2B3", borderRadius: 9, borderWidth: 1, padding: 12 },
  cancelText: { color: "#344054", fontWeight: "800" },
});
