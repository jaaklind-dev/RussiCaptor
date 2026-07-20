import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import OrdersTab from "@/components/patient/OrdersTab";
import { getOrders } from "@/repositories/OrderRepository";
import { placeOrder } from "@/services/OrderService";
import AppHeader from "@/components/AppHeader";
import ImagingTab from "@/components/patient/ImagingTab";
import LabsTab from "@/components/patient/LabsTab";
import QuestionsTab from "@/components/patient/QuestionsTab";
import TimelineTab from "@/components/patient/TimelineTab";
import OverviewTab from "@/components/patient/OverviewTab";
import NotesTab from "@/components/patient/NotesTab";
import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getLabResults } from "@/repositories/LabRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { getQuestions } from "@/repositories/QuestionRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { getNotes } from "@/repositories/NoteRepository";
import {
  openImagingImage,
  openImagingReport,
} from "@/services/ImagingService";
import { openLabPanel } from "@/services/LabService";
import { revealQuestion } from "@/services/RevealService";
import { subscribeToSync } from "@/services/SyncService";
import { addPatientNote } from "@/services/NoteService";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
type PatientTab =
  | "overview"
  | "timeline"
  | "labs"
  | "imaging"
  | "orders"
  | "questions"
  | "notes";

export default function PatientWorkspaceScreen() {

  const { id } = useLocalSearchParams<{ id: string }>();

  const [activeTab, setActiveTab] = useState<PatientTab>("overview");
const [, setRefreshKey] = useState(0);
useEffect(() => {
  return subscribeToSync(() => {
    setRefreshKey((k) => k + 1);
  });
}, []);
  const patient = findPatientById(id ?? "");
const isCompleted = patient?.status === "Completed";
const [questions, setQuestions] = useState(
  patient ? getQuestions(patient.id) : []
);
const [imagingStudies, setImagingStudies] = useState(
  patient ? getImagingStudies(patient.id) : []
);
const [orders, setOrders] = useState(
  patient ? getOrders(patient.id) : []
);

  if (!patient) {

    return (

      <View style={styles.container}>

        <AppHeader />

        <Text style={styles.title}>Patsienti ei leitud</Text>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/dashboard")}>

          <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>

        </Pressable>

      </View>

    );

  }

  return (

    <View style={styles.container}>

      <AppHeader />

      <View style={styles.headerBlock}>

        <Text style={styles.patientId}>{patient.id}</Text>

        <Text style={styles.patientName}>{patient.name}</Text>

        <Text style={styles.patientMeta}>

          {patient.triage} · {patient.location} · {patient.status}

        </Text>

        <Text style={styles.cmLine}>Current CM: Jaak</Text>

        {isCompleted && (
          <Text style={styles.completedNotice}>
            Käsitlus lõpetatud · vaatamisrežiim
          </Text>
        )}

      </View>

   <View style={styles.tabs}>


        <TabButton label="Overview" value="overview" activeTab={activeTab} setActiveTab={setActiveTab} />

        <TabButton label="Timeline" value="timeline" activeTab={activeTab} setActiveTab={setActiveTab} />

        <TabButton label="Labs" value="labs" activeTab={activeTab} setActiveTab={setActiveTab} />

        <TabButton label="Imaging" value="imaging" activeTab={activeTab} setActiveTab={setActiveTab} />

        <TabButton label="Questions" value="questions" activeTab={activeTab} setActiveTab={setActiveTab} />

        <TabButton label="Notes" value="notes" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton label="Orders" value="orders" activeTab={activeTab} setActiveTab={setActiveTab} />

   </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>

        {activeTab === "overview" && <OverviewTab patient={patient} />}

        {activeTab === "timeline" && (
          <TimelineTab events={getTimelineEvents(patient.id)} />
        )}

       {activeTab === "labs" && (
         <LabsTab
           labs={getLabResults(patient.id)}
           readOnly={isCompleted}
           onOpenPanel={(panel) => {
             openLabPanel(patient.id, panel);
           }}
         />
       )}

   {activeTab === "imaging" && (
  <ImagingTab
    studies={imagingStudies}
    readOnly={isCompleted}
    onOpenImage={(study) => {
      openImagingImage(patient.id, study.id, study.title);
      setImagingStudies(getImagingStudies(patient.id));
    }}
    onOpenReport={(study) => {
      openImagingReport(patient.id, study.id, study.title);
      setImagingStudies(getImagingStudies(patient.id));
    }}
  />
)}

{activeTab === "questions" && (
 <QuestionsTab
   questions={questions}
   readOnly={isCompleted}
   onReveal={(questionId) => {
     revealQuestion(patient.id, questionId);
     setQuestions(getQuestions(patient.id));
   }}
 />
)}
{activeTab === "orders" && (
  <OrdersTab
    orders={orders}
    readOnly={isCompleted}
    onPlaceOrder={(order) => {
      placeOrder(order);
      setOrders(getOrders(patient.id));
    }}
  />
)}

        {activeTab === "notes" && (
          <NotesTab
            notes={getNotes(patient.id)}
            readOnly={isCompleted}
            onAddNote={(text) => addPatientNote(patient.id, text)}
          />
        )}

      </ScrollView>

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/dashboard")}>

        <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>

      </Pressable>

    </View>

  );

}

function TabButton({

  label,

  value,

  activeTab,

  setActiveTab,

}: {

  label: string;

  value: PatientTab;

  activeTab: PatientTab;

  setActiveTab: (value: PatientTab) => void;

}) {

  const isActive = activeTab === value;

  return (

    <Pressable

      style={[styles.tabButton, isActive && styles.tabButtonActive]}

      onPress={() => setActiveTab(value)}

    >

      <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>

        {label}

      </Text>

    </Pressable>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "#ffffff",

    padding: 24,

    paddingTop: 108,

  },

  headerBlock: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

    marginBottom: 14,

  },

  patientId: {

    fontSize: 18,

    fontWeight: "bold",

    color: "#005BBB",

  },

  patientName: {

    fontSize: 32,

    fontWeight: "bold",

    marginTop: 4,

  },

  patientMeta: {

    fontSize: 18,

    color: "#555",

    marginTop: 6,

  },

  cmLine: {

    fontSize: 16,

    color: "#777",

    marginTop: 6,

  },

  completedNotice: {
    alignSelf: "flex-start",
    backgroundColor: "#dcfce7",
    color: "#166534",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontWeight: "bold",
    marginTop: 10,
  },

  tabs: {

    width: "100%",

  flexDirection: "row",

  flexWrap: "wrap",

  gap: 8,

  marginBottom: 12,

},

  tabButton: {

    borderWidth: 2,

    borderColor: "#005BBB",

    borderRadius: 12,

    paddingVertical: 10,

    paddingHorizontal: 14,

  },

  tabButtonActive: {

    backgroundColor: "#005BBB",

  },

  tabButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 15,

  },

  tabButtonTextActive: {

    color: "#ffffff",

  },

  content: {

    flex: 1,

  },

  contentInner: {

    paddingBottom: 16,

  },

  card: {

    backgroundColor: "#f2f4f7",

    borderRadius: 16,

    padding: 18,

    gap: 8,

  },

  sectionTitle: {

    fontSize: 22,

    fontWeight: "bold",

    marginBottom: 4,

  },

  row: {

    fontSize: 16,

    color: "#444",

    lineHeight: 23,

  },

  divider: {

    height: 1,

    backgroundColor: "#d0d5dd",

    marginVertical: 10,

  },

  title: {

    fontSize: 34,

    fontWeight: "bold",

    marginBottom: 24,

  },

  secondaryButton: {

    borderColor: "#005BBB",

    borderWidth: 2,

    paddingVertical: 14,

    borderRadius: 12,

    alignItems: "center",

    marginTop: 12,

  },

  secondaryButtonText: {

    color: "#005BBB",

    fontWeight: "bold",

    fontSize: 18,

  },

});
