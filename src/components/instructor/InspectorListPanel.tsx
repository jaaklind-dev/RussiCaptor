import type { InspectorListItem } from "@/models/InstructorPatientInspector";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

const Row = memo(function Row({ item }: { item: InspectorListItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.itemTitle}>{item.title}</Text>
        {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
      </View>
      <View style={styles.trailing}>
        {item.status ? <Text style={styles.status}>{item.status}</Text> : null}
        {item.time ? <Text style={styles.time}>{item.time}</Text> : null}
      </View>
    </View>
  );
});

export function InspectorListPanel({ title, items, emptyText }: {
  title: string; items: readonly InspectorListItem[]; emptyText: string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      {items.length ? items.map(item => <Row key={item.id} item={item} />) : <Text style={styles.empty}>{emptyText}</Text>}
    </View>
  );
}

export const InspectorListRow = Row;

const styles = StyleSheet.create({
  panel: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d0d5dd", borderRadius: 14, padding: 15 },
  title: { fontSize: 18, fontWeight: "800", color: "#172b4d", marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#ebecf0" },
  rowText: { flex: 1 }, trailing: { alignItems: "flex-end", maxWidth: "42%" },
  itemTitle: { color: "#172b4d", fontWeight: "700" }, detail: { color: "#6b778c", fontSize: 12, marginTop: 2 },
  status: { color: "#005bbb", fontWeight: "700", fontSize: 12 }, time: { color: "#6b778c", fontSize: 11, marginTop: 2 },
  empty: { color: "#6b778c", fontStyle: "italic", paddingVertical: 8 },
});
