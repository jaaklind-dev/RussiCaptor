import { getUpcomingScenarioEvents } from "@/repositories/ScenarioRepository";

import { adjustScenarioEventTime } from "@/services/ScenarioControlService";

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { subscribeToSync } from "@/services/SyncService";
export default function UpcomingEventsCard({ session }) {
    const [, setRefreshKey] = useState(0);

    useEffect(() => {
      return subscribeToSync(() => {
        setRefreshKey(value => value + 1);
      });
    }, []);
  const events = getUpcomingScenarioEvents().slice(0, 5);
const currentMinute = session.currentMinute;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Järgmised sündmused</Text>

      {events.length === 0 ? (
        <Text style={styles.empty}>Sündmusi ei ole.</Text>
      ) : (
        events.map((event) => {
          const eventMinute = Number(
            event.triggerAt.replace("+", "").replace("m", "")
          );

          const remainingMinutes = eventMinute - currentMinute;
const isNextEvent = remainingMinutes >= 0 && remainingMinutes === Math.min(
  ...events
    .map(e => Number(e.triggerAt.replace("+", "").replace("m", "")) - currentMinute)
    .filter(m => m >= 0)
);
const status =
  remainingMinutes > 0
    ? "OOTEL"
    : remainingMinutes === 0
      ? "KÄIVITUB"
      : "TÄIDETUD";
          return (
     <View
       key={event.id}
       style={[
         styles.eventBlock,
         isNextEvent && styles.nextEvent,
       ]}
     >
       <View style={styles.row}>
        <Text
          style={[
            styles.minute,
            remainingMinutes < 0
              ? styles.minutePast
              : remainingMinutes === 0
                ? styles.minuteNow
                : styles.minuteUpcoming,
          ]}
        >
          {remainingMinutes < 0
            ? "MÖÖDUNUD"
            : remainingMinutes === 0
              ? "KOHE"
              : `${remainingMinutes} min pärast`}
        </Text>

         <View style={styles.info}>
           <Text style={styles.eventTitle}>
             {event.title}
           </Text>

           <Text style={styles.patient}>
             {event.patientId}
           </Text>

           <View
             style={[
               styles.statusBadge,
               status === "OOTEL"
                 ? styles.statusWaiting
                 : status === "KÄIVITUB"
                   ? styles.statusStarting
                   : styles.statusDone,
             ]}
           >
             <Text style={styles.statusBadgeText}>
               {status}
             </Text>
           </View>
         </View>
       </View>

       <View style={styles.controls}>
         <Pressable
           style={styles.controlButton}
           onPress={() => adjustScenarioEventTime(event.id, -1)}
         >
           <Text style={styles.controlButtonText}>−1 min</Text>
         </Pressable>

         <Pressable
           style={styles.controlButton}
           onPress={() => adjustScenarioEventTime(event.id, 1)}
         >
           <Text style={styles.controlButtonText}>+1 min</Text>
         </Pressable>
       </View>
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
eventBlock: {
  marginBottom: 16,
},

controls: {
  flexDirection: "row",
  gap: 8,
  marginTop: 8,
  marginLeft: 70,
},

controlButton: {
  backgroundColor: "#005BBB",
  paddingVertical: 8,
  paddingHorizontal: 12,
  borderRadius: 8,
},

controlButtonText: {
  color: "#fff",
  fontWeight: "bold",
},
minuteUpcoming: {
  color: "#16a34a",
  fontWeight: "700",
},

minuteNow: {
  color: "#ea580c",
  fontWeight: "700",
},

minutePast: {
  color: "#9ca3af",
  fontWeight: "700",
},
nextEvent: {
  borderColor: "#2563eb",
  borderWidth: 2,
},
status: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: "700",
  color: "#6b7280",
},
statusBadge: {
  alignSelf: "flex-start",
  marginTop: 4,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
},

statusWaiting: {
  backgroundColor: "#DBEAFE",
},

statusStarting: {
  backgroundColor: "#FED7AA",
},

statusDone: {
  backgroundColor: "#DCFCE7",
},

statusBadgeText: {
  fontSize: 11,
  fontWeight: "700",
},
});