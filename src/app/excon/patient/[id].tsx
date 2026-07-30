import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function InstructorPatientInspectorStub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Instructor Patient Inspector</Text>
      <Text style={styles.patient}>{id}</Text>
      <Text style={styles.note}>Patient Inspector will be implemented in a later Instructor Console increment.</Text>
      <Pressable style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Back to Instructor Dashboard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", color: "#172b4d" }, patient: { fontSize: 22, fontWeight: "700", marginTop: 10 },
  note: { color: "#6b778c", marginTop: 12, textAlign: "center" }, button: { marginTop: 24, borderWidth: 2, borderColor: "#005bbb", borderRadius: 12, padding: 13 },
  buttonText: { color: "#005bbb", fontWeight: "800" },
});
