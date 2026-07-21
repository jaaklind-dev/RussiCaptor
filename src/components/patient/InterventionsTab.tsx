import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Intervention, InterventionType } from "@/models/Intervention";
import { interventionLabels } from "@/services/InterventionService";

type Props = {
  interventions: Intervention[];
  readOnly?: boolean;
  onRecord: (type: InterventionType) => boolean;
};

const interventionTypes = Object.keys(interventionLabels) as InterventionType[];

export default function InterventionsTab({
  interventions,
  readOnly = false,
  onRecord,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reageerija tegevused</Text>
      <Text style={styles.description}>
        Registreeri patsiendile teostatud kliiniline tegevus.
      </Text>

      {!readOnly && (
        <View style={styles.actions}>
          {interventionTypes.map((type) => (
            <Pressable
              key={type}
              style={styles.actionButton}
              onPress={() => onRecord(type)}
            >
              <Text style={styles.actionButtonText}>{interventionLabels[type]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.historyTitle}>Tegevuste ajalugu</Text>
      {interventions.length === 0 ? (
        <Text style={styles.empty}>Tegevusi ei ole registreeritud.</Text>
      ) : (
        interventions.map((intervention) => (
          <View key={intervention.id} style={styles.intervention}>
            <Text style={styles.interventionLabel}>{intervention.label}</Text>
            <Text style={styles.meta}>
              {intervention.performedBy} · {new Date(
                intervention.performedAt
              ).toLocaleString("et-EE")}
            </Text>
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
  },
  description: {
    color: "#666",
    marginTop: 4,
    marginBottom: 14,
  },
  actions: {
    gap: 10,
    marginBottom: 22,
  },
  actionButton: {
    backgroundColor: "#005BBB",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 10,
  },
  empty: {
    color: "#666",
    fontStyle: "italic",
  },
  intervention: {
    backgroundColor: "#fff",
    borderColor: "#d0d5dd",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  interventionLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: "#667085",
    fontSize: 13,
    marginTop: 6,
  },
});
