import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Intervention, InterventionOption } from "@/models/Intervention";
import type {
  MedicationAdministration,
  MedicationOption,
} from "@/models/Medication";
import { MassiveTransfusionControls } from "./MassiveTransfusionControls";
import { VascularAccessControls } from "./VascularAccessControls";
import { PleuralDrainControls } from "./PleuralDrainControls";
import { PatientTransportControls } from "./PatientTransportControls";

type Props = {
  patientId: string;
  interventions: Intervention[];
  interventionOptions: InterventionOption[];
  medicationOptions: MedicationOption[];
  medicationAdministrations: MedicationAdministration[];
  readOnly?: boolean;
  onRecord: (optionId: string) => boolean;
  onAdministerMedication: (optionId: string) => boolean;
};

export default function InterventionsTab({
  patientId,
  interventions,
  interventionOptions,
  medicationOptions,
  medicationAdministrations,
  readOnly = false,
  onRecord,
  onAdministerMedication,
}: Props) {
  return (
    <View style={styles.card}>
      <PatientTransportControls patientId={patientId} readOnly={readOnly} />
      <PleuralDrainControls patientId={patientId} readOnly={readOnly} />
      <VascularAccessControls patientId={patientId} readOnly={readOnly} />
      <MassiveTransfusionControls patientId={patientId} readOnly={readOnly} />
      <Text style={styles.title}>Reageerija tegevused</Text>
      <Text style={styles.description}>
        Registreeri patsiendile teostatud kliiniline tegevus.
      </Text>

      {!readOnly && (
        <View style={styles.actions}>
          {interventionOptions.map((option) => (
            <Pressable
              key={option.id}
              style={styles.actionButton}
              onPress={() => onRecord(option.id)}
            >
              <Text style={styles.actionButtonText}>{option.label}</Text>
            </Pressable>
          ))}
          {interventionOptions.length === 0 && (
            <Text style={styles.empty}>Oodatavaid tegevusi ei ole.</Text>
          )}
        </View>
      )}

      <Text style={styles.historyTitle}>Ravimid</Text>
      {!readOnly && (
        <View style={styles.actions}>
          {medicationOptions.map((option) => (
            <Pressable
              key={option.id}
              style={styles.medicationButton}
              onPress={() => onAdministerMedication(option.id)}
            >
              <Text style={styles.actionButtonText}>{option.name}</Text>
              <Text style={styles.medicationDetails}>
                {option.dose} · {option.route}
              </Text>
            </Pressable>
          ))}
          {medicationOptions.length === 0 && (
            <Text style={styles.empty}>Oodatavaid ravimeid ei ole.</Text>
          )}
        </View>
      )}

      {medicationAdministrations.map((item) => (
        <View key={item.id} style={styles.intervention}>
          <Text style={styles.interventionLabel}>{item.name}</Text>
          <Text>{item.dose} · {item.route}</Text>
          <Text style={styles.meta}>
            {item.administeredBy} · {new Date(
              item.administeredAt
            ).toLocaleString("et-EE")}
          </Text>
        </View>
      ))}

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
  medicationButton: {
    backgroundColor: "#6941C6",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center",
  },
  medicationDetails: {
    color: "#E9D7FE",
    marginTop: 3,
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
