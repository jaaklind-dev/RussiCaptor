import { Pressable, StyleSheet, Text, View } from "react-native";
import { LabResult } from "@/models/LabResult";

type Props = {
  labs: LabResult[];
  onOpenPanel: (panel: string) => void;
};

export default function LabsTab({ labs, onOpenPanel }: Props) {
  const panels = [...new Set(labs.map((lab) => lab.panel))];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Laboratory Results</Text>

      {labs.length === 0 ? (
        <Text style={styles.empty}>No laboratory results.</Text>
      ) : (
        panels.map((panel) => {
          const panelLabs = labs.filter((lab) => lab.panel === panel);
          const status = panelLabs[0].status;
          const isRevealed = panelLabs.every(
            (lab) => lab.visibility === "revealed"
          );

          return (
            <View key={panel} style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>{panel}</Text>
                  <Text style={styles.status}>{status}</Text>
                </View>

                {!isRevealed && status === "available" && (
                  <Pressable
                    style={styles.openButton}
                    onPress={() => onOpenPanel(panel)}
                  >
                    <Text style={styles.openButtonText}>Open</Text>
                  </Pressable>
                )}
              </View>

              {panelLabs.map((lab) => (
                <View key={lab.id} style={styles.row}>
                  <Text style={styles.name}>{lab.name}</Text>

                  {lab.visibility === "revealed" ? (
                    <Text style={styles.value}>
                      {lab.value} {lab.unit}
                    </Text>
                  ) : (
                    <Text style={styles.hidden}>Hidden</Text>
                  )}
                </View>
              ))}
            </View>
          );
        })
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
  panel: {
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fff",
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  panelTitle: {
    fontWeight: "bold",
    fontSize: 18,
  },
  status: {
    color: "#666",
    fontWeight: "600",
    marginTop: 2,
  },
  openButton: {
    backgroundColor: "#005BBB",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  openButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  name: {
    fontWeight: "500",
  },
  value: {
    fontWeight: "bold",
  },
  hidden: {
    color: "#999",
    fontStyle: "italic",
  },
});