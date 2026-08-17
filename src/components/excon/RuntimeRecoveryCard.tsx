import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { terminateCurrentExerciseWithMissingRuntime } from "@/services/ExerciseRuntimeRecoveryFoundationService";
import { getRuntimePersistenceFailure, getRuntimePersistenceFailureVersion, subscribeToRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState, useSyncExternalStore } from "react";

export function runtimeRecoveryAvailable(snapshot: CanonicalExerciseSnapshot, failure = getRuntimePersistenceFailure()): boolean {
  return (snapshot.lifecycleState === "RUNNING" || snapshot.lifecycleState === "PAUSED") && failure?.exerciseId === snapshot.exerciseId && failure.code === "ACTIVE_RUNTIME_PERSISTENCE_MISSING";
}

export default function RuntimeRecoveryCard({ snapshot, onRecovered }: { snapshot: CanonicalExerciseSnapshot; onRecovered?: () => void }) {
  useSyncExternalStore(subscribeToRuntimePersistenceFailure, getRuntimePersistenceFailureVersion, getRuntimePersistenceFailureVersion);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string>();
  if (!runtimeRecoveryAvailable(snapshot)) return null;
  const recover = async () => {
    setPending(true); setError(undefined);
    const result = await terminateCurrentExerciseWithMissingRuntime();
    setPending(false);
    if (!result.ok) setError(result.message); else onRecovered?.();
  };
  const confirm = () => Alert.alert("Kas lõpetada taastamatu õppus?", "Simulatsiooni ei saa ohutult jätkata. Puuduvat olekut ei rekonstrueerita, õppus lõpetatakse ja auditikirje säilitatakse.", [
    { text: "Tühista", style: "cancel" }, { text: "Lõpeta katkine õppus", style: "destructive", onPress: () => void recover() },
  ]);
  return <View style={styles.card} testID="runtime-recovery-card">
    <Text style={styles.title}>Simulatsiooni olek pole saadaval</Text>
    <Text style={styles.body}>Simulatsiooni ei saa ohutult taastada, sest canonical Runtime’i püsiandmed puuduvad.</Text>
    <Pressable testID="terminate-missing-runtime" disabled={pending} onPress={confirm} style={[styles.button, pending && styles.disabled]}><Text style={styles.buttonText}>{pending ? "Lõpetan…" : "Lõpeta katkine õppus"}</Text></Pressable>
    {error && <Text style={styles.error}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({ card:{borderWidth:1,borderColor:"#c62828",backgroundColor:"#fff4f4",borderRadius:14,padding:14,marginBottom:14},title:{fontSize:18,fontWeight:"900",color:"#8e1515"},body:{color:"#5f2120",marginTop:7,lineHeight:20},button:{backgroundColor:"#9b1c1c",padding:12,borderRadius:10,alignItems:"center",marginTop:12},disabled:{opacity:.5},buttonText:{color:"#fff",fontWeight:"900"},error:{color:"#9b1c1c",fontWeight:"700",marginTop:9} });
