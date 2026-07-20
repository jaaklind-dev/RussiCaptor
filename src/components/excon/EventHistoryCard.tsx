import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getResolvedScenarioEvents } from "@/repositories/ScenarioRepository";
import { subscribeToSync } from "@/services/SyncService";

export default function EventHistoryCard() {
  const [, setRefreshKey] = useState(0);

  useEffect(() => {
    return subscribeToSync(() => setRefreshKey((value) => value + 1));
  }, []);

  const events = getResolvedScenarioEvents().slice(0, 10);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Sündmuste ajalugu</Text>

      {events.length === 0 ? (
        <Text style={styles.empty}>Täidetud sündmusi veel ei ole.</Text>
      ) : (
        events.map((event) => {
          const isCancelled = event.cancelled === true;

          return (
            <View key={event.id} style={styles.eventRow}>
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventMeta}>
                  {event.patientId} · õppuse minut {event.resolvedAtMinute ?? "–"}
                </Text>
              </View>
              <Text
                style={[
                  styles.badge,
                  isCancelled ? styles.cancelledBadge : styles.executedBadge,
                ]}
              >
                {isCancelled ? "Tühistatud" : "Täidetud"}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
    width: "100%",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },
  empty: {
    color: "#666",
  },
  eventRow: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  eventInfo: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  eventMeta: {
    color: "#666",
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: "bold",
    overflow: "hidden",
  },
  executedBadge: {
    color: "#166534",
    backgroundColor: "#dcfce7",
  },
  cancelledBadge: {
    color: "#991b1b",
    backgroundColor: "#fee2e2",
  },
});
