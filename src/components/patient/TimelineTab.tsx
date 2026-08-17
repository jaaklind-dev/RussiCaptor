import { StyleSheet, Text, View } from "react-native";
import { TimelineEvent } from "@/models/TimelineEvent";

type Props = {
  events: TimelineEvent[];
};

export default function TimelineTab({ events }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Ajajoon</Text>

      {events.length === 0 ? (
        <Text style={styles.empty}>Sündmusi veel ei ole.</Text>
      ) : (
        events.map((event) => (
          <View key={event.id} style={styles.event}>
            <Text style={styles.time}>
              {new Date(event.timestamp).toLocaleTimeString()}
            </Text>

            <Text style={styles.eventTitle}>{event.title}</Text>

            <Text style={styles.description}>
              {event.description}
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
    marginBottom: 14,
  },

  empty: {
    color: "#666",
    fontStyle: "italic",
  },

  event: {
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 10,
    marginTop: 10,
  },

  time: {
    fontSize: 12,
    color: "#666",
  },

  eventTitle: {
    fontWeight: "bold",
    marginTop: 2,
  },

  description: {
    marginTop: 4,
  },
});