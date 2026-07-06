import { router } from "expo-router";

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import AppHeader from "@/components/AppHeader";

import { getMyPatients } from "@/services/AssignmentRepository";

export default function PatientsScreen() {

  const myPatients = getMyPatients();

  return (

    <View style={styles.container}>

      <AppHeader />

      <Text style={styles.title}>My Patients</Text>

      <Text style={styles.subtitle}>Case Manager: Jaak</Text>

      {myPatients.length === 0 ? (

        <View style={styles.emptyCard}>

          <Text style={styles.emptyTitle}>Patsiente ei ole veel.</Text>

          <Text style={styles.emptyText}>

            Skaneeri patsiendi QR-kood, et lisada ta oma nimekirja.

          </Text>

        </View>

      ) : (

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>

          {myPatients.map((patient) => (

            <Pressable

              key={patient.id}

              style={styles.patientCard}

              onPress={() => router.push(`/patient/${patient.id}`)}

            >

              <View style={styles.patientHeader}>

                <Text style={styles.patientId}>{patient.id}</Text>

                <Text style={styles.triageBadge}>{patient.triage}</Text>

              </View>

              <Text style={styles.patientName}>{patient.name}</Text>

              <Text style={styles.patientMeta}>

                {patient.status} · {patient.location}

              </Text>

              <Text style={styles.patientTime}>Last seen: {patient.lastSeen}</Text>

            </Pressable>

          ))}

        </ScrollView>

      )}

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/dashboard")}>

        <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>

      </Pressable>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "#ffffff",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 38,

    fontWeight: "bold",

    marginBottom: 12,

  },

  subtitle: {

    fontSize: 20,

    color: "#555",

    marginBottom: 20,

  },

  emptyCard: {

    width: "100%",

    maxWidth: 360,

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 24,

    marginBottom: 24,

  },

  emptyTitle: {

    fontSize: 22,

    fontWeight: "bold",

    marginBottom: 8,

  },

  emptyText: {

    fontSize: 16,

    color: "#555",

    lineHeight: 22,

  },

  list: {

    width: "100%",

    maxWidth: 420,

    marginTop: 20,

  },

  listContent: {

    gap: 12,

    paddingBottom: 20,

  },

  patientCard: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

  },

  patientHeader: {

    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",

  },

  patientId: {

    fontSize: 18,

    fontWeight: "bold",

  },

  triageBadge: {

    backgroundColor: "#f5c542",

    paddingHorizontal: 12,

    paddingVertical: 6,

    borderRadius: 10,

    fontWeight: "bold",

  },

  patientName: {

    fontSize: 24,

    fontWeight: "bold",

    marginTop: 8,

  },

  patientMeta: {

    fontSize: 16,

    color: "#555",

    marginTop: 6,

  },

  patientTime: {

    fontSize: 14,

    color: "#777",

    marginTop: 6,

  },

  secondaryButton: {

    width: "100%",

    maxWidth: 360,

    borderWidth: 2,

    borderColor: "#005BBB",

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginTop: 16,

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});