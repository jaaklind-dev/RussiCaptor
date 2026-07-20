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
import {
  canCurrentCaseManagerEditPatient,
  acceptPatientTransfer,
  getPatientAssignment,
  getPendingPatientTransfer,
  rejectPatientTransfer,
} from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
const assignment = patient ? getPatientAssignment(patient.id) : undefined;
const pendingTransfer = patient ? getPendingPatientTransfer(patient.id) : undefined;
const isReadOnly = patient
  ? isCompleted || !canCurrentCaseManagerEditPatient(patient.id)
  : true;
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

        <Text style={styles.cmLine}>
          Current CM: {assignment?.caseManagerName ?? "Määramata"}
        </Text>

        {isCompleted && (
          <Text style={styles.completedNotice}>
            Käsitlus lõpetatud · vaatamisrežiim
          </Text>
        )}

        {!isCompleted && isReadOnly && (
          <Text style={styles.readOnlyNotice}>
            Määratud CM-ile {assignment?.caseManagerName ?? "–"} · vaatamisrežiim
          </Text>
        )}

        {!isReadOnly && pendingTransfer && (
          <View style={styles.takeoverCard}>
            <Text style={styles.takeoverTitle}>Ülevõtmistaotlus</Text>
            <Text style={styles.takeoverText}>
              {pendingTransfer.toCaseManagerName} soovib patsiendi üle võtta.
            </Text>
            <View style={styles.takeoverActions}>
              <Pressable
                style={styles.rejectButton}
                onPress={() => {
                  Alert.alert(
                    "Keeldu ülevõtmisest?",
                    `${pendingTransfer.toCaseManagerName} ei saa patsiendi omanikuks.`,
                    [
                      { text: "Katkesta", style: "cancel" },
                      {
                        text: "Keeldu",
                        style: "destructive",
                        onPress: () => rejectPatientTransfer(
                          patient.id,
                          getCurrentCaseManager()
                        ),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.transferButtonText}>Keeldu</Text>
              </Pressable>
              <Pressable
                style={styles.acceptButton}
                onPress={() => {
                  Alert.alert(
                    "Nõustu ülevõtmisega?",
                    `Patsiendi uus Case Manager on ${pendingTransfer.toCaseManagerName}.`,
                    [
                      { text: "Katkesta", style: "cancel" },
                      {
                        text: "Nõustu",
                        onPress: () => acceptPatientTransfer(
                          patient.id,
                          getCurrentCaseManager()
                        ),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.transferButtonText}>Nõustu</Text>
              </Pressable>
            </View>
          </View>
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
           readOnly={isReadOnly}
           onOpenPanel={(panel) => {
             openLabPanel(patient.id, panel);
           }}
         />
       )}

   {activeTab === "imaging" && (
  <ImagingTab
    studies={imagingStudies}
    readOnly={isReadOnly}
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
   readOnly={isReadOnly}
   onReveal={(questionId) => {
     revealQuestion(patient.id, questionId);
     setQuestions(getQuestions(patient.id));
   }}
 />
)}
{activeTab === "orders" && (
  <OrdersTab
    orders={orders}
    readOnly={isReadOnly}
    onPlaceOrder={(order) => {
      placeOrder(order);
      setOrders(getOrders(patient.id));
    }}
  />
)}

        {activeTab === "notes" && (
          <NotesTab
            notes={getNotes(patient.id)}
            readOnly={isReadOnly}
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

  readOnlyNotice: {
    alignSelf: "flex-start",
    backgroundColor: "#fef3c7",
    color: "#92400e",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontWeight: "bold",
    marginTop: 10,
  },

  takeoverCard: {
    backgroundColor: "#fff7ed",
    borderColor: "#f59e0b",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  takeoverTitle: {
    color: "#92400e",
    fontWeight: "bold",
    fontSize: 16,
  },
  takeoverText: {
    color: "#92400e",
    marginTop: 4,
  },
  takeoverActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  acceptButton: {
    backgroundColor: "#166534",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  rejectButton: {
    backgroundColor: "#b42318",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },

  transferButtonText: {
    color: "#fff",
    fontWeight: "bold",
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
