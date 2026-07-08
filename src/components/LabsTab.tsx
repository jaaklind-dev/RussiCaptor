import { StyleSheet, Text, View } from "react-native";
import { LabResult } from "@/models/LabResult";

type Props = {
  labs: LabResult[];
};

export default function LabsTab({ labs }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Laboratory Results</Text>

      {labs.length === 0 ? (
        <Text style={styles.empty}>No laboratory results.</Text>
      ) : (
        labs.map((lab) => (
          <View key={lab.id} style={styles.row}>
            <Text style={styles.name}>
              {lab.panel} • {lab.name}
            </Text>

            <Text style={styles.status}>
              {lab.status}
            </Text>

            {lab.visibility === "revealed" && (
              <Text style={styles.value}>
                {lab.value} {lab.unit}
              </Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
  },

  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },

  empty: {
    color: "#666",
    fontStyle: "italic",
  },

  row: {
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 10,
    marginTop: 10,
  },

  name: {
    fontWeight: "bold",
  },

  status: {
    color: "#666",
    marginTop: 2,
  },

  value: {
    marginTop: 6,
    fontSize: 16,
  },
});