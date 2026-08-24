import { StyleSheet, Text, View } from "react-native";

import { Patient } from "@/models/Patient";
import type { TimelineEvent } from "@/models/TimelineEvent";
import type { VitalSigns } from "@/models/VitalSigns";
import { patientHistoryDescriptionLabel, patientHistoryTitleLabel } from "./TimelinePresentation";

type Props = {

  patient: Patient;
  latestVitals?: VitalSigns;
  recentEvents: TimelineEvent[];

};

export default function OverviewTab({
  patient,
  latestVitals,
  recentEvents = [],
}: Props) {

  return (

    <View style={styles.container}>
      <View style={styles.card}>

      <Text style={styles.sectionTitle}>MIST</Text>

      <Text style={styles.row}>

        <Text style={styles.label}>M:</Text> {patient.mist.mechanism}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>I:</Text> {patient.mist.injuries}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>S:</Text> {patient.mist.signs}

      </Text>

      <Text style={styles.row}>

        <Text style={styles.label}>T:</Text> {patient.mist.treatment}

      </Text>

      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Viimased elulised näitajad</Text>
        {!latestVitals ? (
          <Text style={styles.empty}>Näidud puuduvad.</Text>
        ) : (
          <View style={styles.vitalsGrid}>
            <Vital label="Pulss" value={`${latestVitals.heartRate ?? "–"} /min`} />
            <Vital
              label="Vererõhk"
              value={`${latestVitals.systolicBloodPressure ?? "–"}/${latestVitals.diastolicBloodPressure ?? "–"} mmHg`}
            />
            <Vital label="Hingamine" value={`${latestVitals.respiratoryRate ?? "–"} /min`} />
            <Vital label="SpO₂" value={`${latestVitals.oxygenSaturation ?? "–"} %`} />
            <Vital label="Temperatuur" value={`${latestVitals.temperature ?? "–"} °C`} />
            <Vital label="GCS" value={`${latestVitals.gcs ?? "–"}`} />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Viimased sündmused</Text>
        {recentEvents.length === 0 ? (
          <Text style={styles.empty}>Sündmusi ei ole.</Text>
        ) : (
          recentEvents.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{patientHistoryTitleLabel(event)}</Text>
              <Text style={styles.eventDescription}>{patientHistoryDescriptionLabel(event.description)}</Text>
            </View>
          ))
        )}
      </View>
    </View>

  );

}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.vital}>
      <Text style={styles.vitalLabel}>{label}</Text>
      <Text style={styles.vitalValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    gap: 14,
  },

  card: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

  },

  sectionTitle: {

    fontSize: 22,

    fontWeight: "bold",

    marginBottom: 14,

  },

  label: {

    fontWeight: "bold",

  },

  row: {

    fontSize: 16,

    lineHeight: 24,

    marginBottom: 10,

  },

  empty: {
    color: "#667085",
    fontStyle: "italic",
  },

  vitalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  vital: {
    width: "48%",
    backgroundColor: "#fff",
    borderColor: "#d0d5dd",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },

  vitalLabel: {
    color: "#667085",
    fontSize: 12,
  },

  vitalValue: {
    color: "#101828",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 3,
  },

  eventRow: {
    backgroundColor: "#fff",
    borderColor: "#d0d5dd",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },

  eventTitle: {
    fontWeight: "bold",
  },

  eventDescription: {
    color: "#667085",
    marginTop: 4,
  },

});
