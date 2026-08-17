import { ExerciseEvaluationSummary } from "@/components/excon/evaluation/ExerciseEvaluationSummary";
import { getExerciseEvaluationResult, getExerciseEvaluationVersion, subscribeToExerciseEvaluation } from "@/services/ExerciseEvaluationService";
import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { InstructorEvaluationPanel } from "@/components/excon/evaluation/InstructorEvaluationPanel";

export default function ExerciseEvaluationScreen() {
  useSyncExternalStore(subscribeToExerciseEvaluation, getExerciseEvaluationVersion, getExerciseEvaluationVersion);
  const result = getExerciseEvaluationResult();
  return <ScrollView contentContainerStyle={styles.container}><View style={styles.top}><View><Text style={styles.title}>Õppuse hinnang</Text><Text style={styles.subtitle}>Õppusepõhine kanooniliste WP-38 tulemuste kategooriavaade</Text></View><Pressable onPress={() => router.back()}><Text style={styles.back}>Tagasi</Text></Pressable></View>{result ? <><ExerciseEvaluationSummary result={result} /><InstructorEvaluationPanel source={result} /></> : <Text style={styles.empty}>Selle õppusega pole seotud hindamisprofiili.</Text>}<Text style={styles.note}>Masinhinnang ja inimese tõlgendus on eraldatud. Vaade ei määra skoori, hinnet, läbimist ega pädevusotsust.</Text></ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 18, paddingBottom: 40, backgroundColor: "#fff", flexGrow: 1 }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }, title: { color: "#172b4d", fontSize: 28, fontWeight: "900" }, subtitle: { color: "#5e6c84", marginTop: 3 }, back: { color: "#005bbb", fontWeight: "800" }, empty: { color: "#6b778c", marginVertical: 20 }, note: { color: "#6b778c", fontSize: 12 } });
