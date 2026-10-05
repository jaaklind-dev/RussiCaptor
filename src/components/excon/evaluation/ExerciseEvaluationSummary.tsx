import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { assessmentStatusLabel } from "@/localization/et";

const classificationLabel = (value: string): string => ({ CRITICAL: "Kriitiline", CORE: "Põhinõue", INFORMATIVE: "Lisateave" }[value] ?? "Nõue");

export function ExerciseEvaluationSummary({ result, compact = false }: { result: ExerciseEvaluationResult; compact?: boolean }) {
  return <View style={styles.card}><Text style={styles.title}>Õppuse hinnang</Text>
    {result.dimensions.map(dimension => <View key={dimension.dimensionId} style={styles.dimension}><Text style={styles.dimensionTitle}>{dimension.title}</Text>{dimension.expectations.map((item, index) => <Pressable key={`${item.expectationId}:${item.subjectId ?? item.patientId ?? index}`} disabled={!item.assessmentId} onPress={() => item.assessmentId && router.push({ pathname: "/excon/assessment", params: { assessmentId: item.assessmentId } })} style={styles.expectation}><View style={styles.row}><Text style={[styles.classification, item.classification === "CRITICAL" && styles.critical]}>{classificationLabel(item.classification)}</Text><Text style={styles.status}>{assessmentStatusLabel(item.status)}</Text></View><Text style={styles.expectationId}>Nõue {index + 1}</Text></Pressable>)}{!compact && dimension.metricResults.length > 0 && <Text style={styles.metric}>Koondmõõdikuid: {dimension.metricResults.length}</Text>}</View>)}
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "#f4f6f8", borderRadius: 12, padding: 14, marginBottom: 12 }, title: { color: "#172b4d", fontSize: 18, fontWeight: "900" }, dimension: { marginTop: 12, gap: 7 }, dimensionTitle: { color: "#172b4d", fontWeight: "900" }, expectation: { backgroundColor: "#fff", borderRadius: 8, padding: 10 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, classification: { color: "#005bbb", fontSize: 11, fontWeight: "900" }, critical: { color: "#7a5700", backgroundColor: "#fff3cd", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, overflow: "hidden" }, status: { color: "#172b4d", fontWeight: "900" }, expectationId: { color: "#42526e", marginTop: 4 }, metric: { color: "#42526e", fontSize: 12 } });
