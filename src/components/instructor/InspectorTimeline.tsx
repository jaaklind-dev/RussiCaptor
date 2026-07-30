import type { InspectorListItem } from "@/models/InstructorPatientInspector";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { InspectorListRow } from "@/components/instructor/InspectorListPanel";

export function InspectorTimeline({ items, scrollEnabled = true }: {
  items: readonly InspectorListItem[]; scrollEnabled?: boolean;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Timeline</Text>
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <InspectorListRow item={item} />}
        scrollEnabled={scrollEnabled}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        ListEmptyComponent={<Text style={styles.empty}>No timeline events</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 250, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d0d5dd", borderRadius: 14, padding: 15 },
  title: { fontSize: 18, fontWeight: "800", color: "#172b4d", marginBottom: 8 }, empty: { color: "#6b778c", fontStyle: "italic", paddingVertical: 8 },
});
