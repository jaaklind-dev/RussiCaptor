import { getUpcomingScenarioEvents } from "@/repositories/ScenarioRepository";
import { StyleSheet, Text, View } from "react-native";

export default function UpcomingEventsCard() {
  const events = getUpcomingScenarioEvents().slice(0, 5);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Järgmised sündmused</Text>

      {events.length === 0 ? (
        <Text style={styles.empty}>Sündmusi ei ole.</Text>
      ) : (
        events.map((event) => (
          <View key={event.id} style={styles.row}>
            <Text style={styles.minute}>
              {event.triggerMinute} min
            </Text>

            <View style={styles.info}>
              <Text style={styles.eventTitle}>
                {event.title}
              </Text>

              <Text style={styles.patient}>
                {event.patientId}
              </Text>
            </View>
          </View>
        ))
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
    marginBottom: 16,
  },

  row: {
    flexDirection: "row",
    marginBottom: 14,
  },

  minute: {
    width: 70,
    fontWeight: "bold",
    fontSize: 16,
  },

  info: {
    flex: 1,
  },

  eventTitle: {
    fontWeight: "600",
    fontSize: 16,
  },

  patient: {
    color: "#666",
    marginTop: 2,
  },

  empty: {
    color: "#666",
  },
});