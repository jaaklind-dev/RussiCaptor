import type { InstructorDashboardFilters } from "@/models/InstructorDashboard";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";

type FilterKey = keyof InstructorDashboardFilters;

export function InstructorFilterBar({ filters, options, onChange }: {
  filters: InstructorDashboardFilters;
  options: Record<FilterKey, readonly string[]>;
  onChange: (key: FilterKey, value: string) => void;
}) {
  return (
    <View style={styles.container}>
      {(["location", "triage", "caseManager", "status"] as FilterKey[]).map(key => (
        <View key={key} style={styles.group}>
          <Text style={styles.label}>{key === "caseManager" ? "Case Manager" : key[0].toUpperCase() + key.slice(1)}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
            {options[key].map(option => (
              <Pressable
                key={option}
                onPress={() => onChange(key, option)}
                style={[styles.option, filters[key] === option && styles.selected]}
              >
                <Text style={[styles.optionText, filters[key] === option && styles.selectedText]}>{option}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#f2f4f7", padding: 12, borderRadius: 14, gap: 9, marginBottom: 12 },
  group: { gap: 5 }, label: { color: "#42526e", fontSize: 12, fontWeight: "800" },
  options: { gap: 6 }, option: { borderWidth: 1, borderColor: "#a5adba", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  selected: { backgroundColor: "#005bbb", borderColor: "#005bbb" }, optionText: { color: "#42526e", fontSize: 12, fontWeight: "700" },
  selectedText: { color: "#fff" },
});
