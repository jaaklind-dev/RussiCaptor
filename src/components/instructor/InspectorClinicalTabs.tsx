import type { InspectorListItem, InspectorTab } from "@/models/InstructorPatientInspector";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { InspectorListPanel } from "@/components/instructor/InspectorListPanel";

const tabs: InspectorTab[] = ["Interventions", "Medications", "Labs", "Imaging", "Orders", "Notes"];
const emptyText: Record<InspectorTab, string> = {
  Interventions: "No interventions", Medications: "No medication administrations",
  Labs: "No laboratory results", Imaging: "No imaging", Orders: "No orders", Notes: "No notes",
};

export function InspectorClinicalTabs({ data }: { data: Record<InspectorTab, readonly InspectorListItem[]> }) {
  const [active, setActive] = useState<InspectorTab>("Interventions");
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map(tab => (
          <Pressable key={tab} onPress={() => setActive(tab)} style={[styles.tab, active === tab && styles.activeTab]}>
            <Text style={[styles.tabText, active === tab && styles.activeText]}>{tab} ({data[tab].length})</Text>
          </Pressable>
        ))}
      </ScrollView>
      <InspectorListPanel title={active} items={data[active]} emptyText={emptyText[active]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 }, tabs: { gap: 6 }, tab: { borderWidth: 1, borderColor: "#a5adba", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  activeTab: { backgroundColor: "#005bbb", borderColor: "#005bbb" }, tabText: { color: "#42526e", fontWeight: "700", fontSize: 12 }, activeText: { color: "#fff" },
});
