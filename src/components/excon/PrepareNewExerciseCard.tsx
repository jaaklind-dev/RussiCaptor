import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { createExercisePreparationCommand, exercisePreparationService } from "@/services/exercise/ExercisePreparationService";
import { router } from "expo-router";
import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function canPrepareNewExercise(state: CanonicalExerciseSnapshot["lifecycleState"]): boolean { return state === "COMPLETED"; }
export function getPrepareNewExercisePresentation(state: CanonicalExerciseSnapshot["lifecycleState"], hasActivePackage: boolean, pending: boolean) { return Object.freeze({ visible: canPrepareNewExercise(state), showCatalogGuidance: state === "COMPLETED" && !hasActivePackage, enabled: state === "COMPLETED" && hasActivePackage && !pending, label: pending ? "Preparing…" : "Prepare New Exercise" }); }
export default function PrepareNewExerciseCard({ snapshot, onPrepared }: { snapshot: CanonicalExerciseSnapshot; onPrepared?: () => void }) {
  useSyncExternalStore(listener => activeExercisePackageService.subscribe(listener), () => activeExercisePackageService.getVersion(), () => activeExercisePackageService.getVersion());
  const activePackage = activeExercisePackageService.getActive(); const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<string>();
  if (!canPrepareNewExercise(snapshot.lifecycleState)) return null;
  const prepare = () => {
    if (pending.current) return; pending.current = true; setSubmitting(true); setError(undefined);
    const result = exercisePreparationService.prepare(createExercisePreparationCommand());
    if (!result.ok) setError(result.message); pending.current = false; setSubmitting(false);
    if (result.ok) onPrepared?.();
  };
  return <View style={styles.card} testID="prepare-new-exercise-card"><Text style={styles.title}>Next exercise</Text>
    {activePackage ? <><Text style={styles.package}>{activePackage.metadata.name}</Text><Text style={styles.meta}>{activePackage.packageId}@{activePackage.packageVersion}</Text>
      <Pressable testID="prepare-new-exercise" disabled={submitting} onPress={prepare} style={[styles.button, submitting && styles.disabled]}><Text style={styles.buttonText}>{submitting ? "Preparing…" : "Prepare New Exercise"}</Text></Pressable></>
      : <><Text style={styles.guidance}>Select an Exercise Package before preparing a new exercise.</Text><Pressable testID="prepare-open-catalog" style={styles.catalog} onPress={() => router.push("/excon/catalog")}><Text style={styles.catalogText}>Open Exercise Catalog</Text></Pressable></>}
    {error && <Text testID="prepare-error" style={styles.error}>{error}</Text>}
    <Text style={styles.note}>Preparation creates a new READY exercise. Start remains a separate action.</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderColor: "#b3d4ff", backgroundColor: "#f0f7ff", borderRadius: 14, padding: 14, marginBottom: 14 }, title: { fontSize: 18, fontWeight: "900", color: "#172b4d" }, package: { marginTop: 8, fontWeight: "800", color: "#172b4d" }, meta: { color: "#6b778c", marginTop: 2, fontSize: 12 }, guidance: { color: "#42526e", marginTop: 8 }, button: { backgroundColor: "#005bbb", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 12 }, disabled: { opacity: 0.5 }, buttonText: { color: "#fff", fontWeight: "900" }, catalog: { borderWidth: 1, borderColor: "#005bbb", padding: 11, borderRadius: 10, alignItems: "center", marginTop: 12 }, catalogText: { color: "#005bbb", fontWeight: "900" }, error: { color: "#9b1c1c", marginTop: 9, fontWeight: "700" }, note: { color: "#6b778c", fontSize: 11, marginTop: 9 } });
