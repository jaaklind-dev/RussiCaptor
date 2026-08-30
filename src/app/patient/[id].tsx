import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import OrdersTab from "@/components/patient/OrdersTab";
import { getOrders } from "@/repositories/OrderRepository";
import { placeOrderConflictSafe } from "@/services/OrderService";
import AppHeader from "@/components/AppHeader";
import ImagingTab from "@/components/patient/ImagingTab";
import LabsTab from "@/components/patient/LabsTab";
import QuestionsTab from "@/components/patient/QuestionsTab";
import TimelineTab from "@/components/patient/TimelineTab";
import OverviewTab from "@/components/patient/OverviewTab";
import NotesTab from "@/components/patient/NotesTab";
import InterventionsTab from "@/components/patient/InterventionsTab";
import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getLabResults } from "@/repositories/LabRepository";
import { findPatientById } from "@/repositories/PatientRepository";
import { getQuestions } from "@/repositories/QuestionRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { getNotes } from "@/repositories/NoteRepository";
import {
  getInterventions,
  getInterventionOptions,
} from "@/repositories/InterventionRepository";
import {
  getMedicationAdministrations,
  getMedicationOptions,
} from "@/repositories/MedicationRepository";
import {
  openImagingImageConflictSafe,
  openImagingReportConflictSafe,
} from "@/services/ImagingService";
import { openLabPanelConflictSafe } from "@/services/LabService";
import { revealQuestionConflictSafe } from "@/services/RevealService";
import { subscribeToSync } from "@/services/SyncService";
import { addPatientNoteConflictSafe } from "@/services/NoteService";
import { recordInterventionConflictSafe } from "@/services/InterventionService";
import { administerMedicationConflictSafe } from "@/services/MedicationService";
import {
  canCurrentCaseManagerEditPatient,
  acceptPatientTransferConflictSafe,
  getPatientAssignment,
  getPendingPatientTransfer,
  rejectPatientTransferConflictSafe,
} from "@/services/AssignmentRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import VitalsTab from "@/components/patient/VitalsTab";
import { getVitalSigns } from "@/repositories/VitalSignsRepository";
import { recordVitalSignsConflictSafe } from "@/services/VitalSignsService";
import ResourceDeveloperCard from "@/components/patient/ResourceDeveloperCard";
import ActiveInterventionsCard from "@/components/patient/ActiveInterventionsCard";
import ClinicalAssessmentDeveloperCard from "@/components/patient/ClinicalAssessmentDeveloperCard";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots } from "@/services/RuntimeSnapshotService";
import { SingleFlightActionGate } from "@/services/ui/InteractionSafety";
type PatientTab =
  | "overview"
  | "vitals"
  | "timeline"
  | "labs"
  | "imaging"
  | "orders"
  | "questions"
  | "notes"
  | "actions";

export default function PatientWorkspaceScreen() {

  const { id } = useLocalSearchParams<{ id: string }>();

const [activeTab, setActiveTab] = useState<PatientTab>("overview");
const [showMoreTabs, setShowMoreTabs] = useState(false);
const [, setRefreshKey] = useState(0);
const [workflowMessage,setWorkflowMessage]=useState<string>();
const [workflowPending,setWorkflowPending]=useState(false);
const workflowGate=useRef(new SingleFlightActionGate()).current;
const runWorkflow=async <T extends {message:string}>(operation:()=>Promise<T>):Promise<T>=>{setWorkflowPending(true);setWorkflowMessage("Muudatus ootab serveri kinnitust…");
  try{const outcome=await workflowGate.run(operation);setWorkflowMessage(outcome.message);return outcome;}finally{setWorkflowPending(false);}};
  const runtimeVersion = useSyncExternalStore(subscribeToRuntimeSnapshots, getRuntimeSnapshotVersion, getRuntimeSnapshotVersion);
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
useEffect(() => {
  return subscribeToSync(() => {
    setRefreshKey((k) => k + 1);

    if (id) {
      setQuestions(getQuestions(id));
      setImagingStudies(getImagingStudies(id));
      setOrders(getOrders(id));
    }
  });
}, [id]);

  if (!patient) {

    return (

      <View style={styles.container}>

        <AppHeader />

        <Text style={styles.title}>Patsienti ei leitud</Text>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/dashboard")}>

          <Text style={styles.secondaryButtonText}>Tagasi töölauale</Text>

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
          Praegune juhtumikorraldaja: {assignment?.caseManagerName ?? "Määramata"}
        </Text>
        {workflowMessage&&<Text accessibilityRole="alert" style={workflowPending?styles.pendingNotice:styles.workflowNotice}>{workflowMessage}</Text>}

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
                        onPress: () => void runWorkflow(()=>rejectPatientTransferConflictSafe(
                          patient.id,
                          getCurrentCaseManager()
                        )),
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
                    `Patsiendi uus juhtumikorraldaja on ${pendingTransfer.toCaseManagerName}.`,
                    [
                      { text: "Katkesta", style: "cancel" },
                      {
                        text: "Nõustu",
                        onPress: () => void runWorkflow(()=>acceptPatientTransferConflictSafe(
                          patient.id,
                          getCurrentCaseManager()
                        )),
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
        <TabButton label="Ülevaade" value="overview" activeTab={activeTab} setActiveTab={(value) => {
          setShowMoreTabs(false);
          setActiveTab(value);
        }} />
        <TabButton label="Näitajad" value="vitals" activeTab={activeTab} setActiveTab={(value) => {
          setShowMoreTabs(false);
          setActiveTab(value);
        }} />
        <TabButton label="Tegevused" value="actions" activeTab={activeTab} setActiveTab={(value) => {
          setShowMoreTabs(false);
          setActiveTab(value);
        }} />
        <Pressable
          style={[styles.tabButton, showMoreTabs && styles.tabButtonActive]}
          onPress={() => setShowMoreTabs((current) => !current)}
        >
          <Text style={[styles.tabButtonText, showMoreTabs && styles.tabButtonTextActive]}>
            Rohkem {showMoreTabs ? "▲" : "▼"}
          </Text>
        </Pressable>
      </View>

      {showMoreTabs && (
        <View style={styles.moreTabs}>
          <TabButton label="Ajalugu" value="timeline" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton label="Analüüsid" value="labs" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton label="Uuringud" value="imaging" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton label="Küsimused" value="questions" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton label="Märkmed" value="notes" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton label="Tellimused" value="orders" activeTab={activeTab} setActiveTab={setActiveTab} />
        </View>
      )}

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.content} contentContainerStyle={styles.contentInner}>

        {activeTab === "overview" && (
          <>
            <OverviewTab
              patient={patient}
              latestVitals={getVitalSigns(patient.id)[0]}
              recentEvents={getTimelineEvents(patient.id).slice(-3).reverse()}
            />
            <ActiveInterventionsCard patientId={patient.id} />
            {__DEV__ && <ResourceDeveloperCard patientId={patient.id} />}
            {__DEV__ && <ClinicalAssessmentDeveloperCard />}
          </>
        )}

        {activeTab === "vitals" && (
          <VitalsTab
            measurements={getVitalSigns(patient.id)}
            canonicalRuntime={getCanonicalPatientRuntimeSnapshot(patient.id, runtimeVersion)}
            readOnly={isReadOnly}
            onRecord={async (values) => Boolean((await runWorkflow(()=>recordVitalSignsConflictSafe(patient.id, values))).value)}
          />
        )}

        {activeTab === "timeline" && (
          <TimelineTab events={getTimelineEvents(patient.id)} />
        )}

       {activeTab === "labs" && (
         <LabsTab
           labs={getLabResults(patient.id)}
           readOnly={isReadOnly}
           onOpenPanel={(panel) => {
             void runWorkflow(()=>openLabPanelConflictSafe(patient.id, panel));
           }}
         />
       )}

   {activeTab === "imaging" && (
  <ImagingTab
    studies={imagingStudies}
    readOnly={isReadOnly}
    onOpenImage={(study) => {
      void runWorkflow(()=>openImagingImageConflictSafe(patient.id, study.id, study.title));
    }}
    onOpenReport={(study) => {
      void runWorkflow(()=>openImagingReportConflictSafe(patient.id, study.id, study.title));
    }}
  />
)}

{activeTab === "questions" && (
 <QuestionsTab
   questions={questions}
   readOnly={isReadOnly}
   onReveal={(questionId) => {
     void runWorkflow(()=>revealQuestionConflictSafe(patient.id, questionId));
   }}
 />
)}
{activeTab === "orders" && (
  <OrdersTab
    orders={orders}
    readOnly={isReadOnly}
    onPlaceOrder={(order) => {
      void runWorkflow(()=>placeOrderConflictSafe(order));
    }}
  />
)}

        {activeTab === "notes" && (
          <NotesTab
            notes={getNotes(patient.id)}
            readOnly={isReadOnly}
            onAddNote={async (text) => Boolean((await runWorkflow(()=>addPatientNoteConflictSafe(patient.id, text))).value)}
          />
        )}

        {activeTab === "actions" && (
          <InterventionsTab
            patientId={patient.id}
            interventions={getInterventions(patient.id)}
            interventionOptions={getInterventionOptions(patient.id)}
            medicationOptions={getMedicationOptions(patient.id)}
            medicationAdministrations={getMedicationAdministrations(patient.id)}
            readOnly={isReadOnly}
            onRecord={async (optionId) => Boolean((await runWorkflow(()=>recordInterventionConflictSafe(patient.id, optionId))).value)}
            onAdministerMedication={async (optionId) =>
              Boolean((await runWorkflow(()=>administerMedicationConflictSafe(patient.id, optionId))).value)
            }
          />
        )}

      </ScrollView>

      <Pressable style={styles.secondaryButton} onPress={() => router.push("/dashboard")}>

        <Text style={styles.secondaryButtonText}>Tagasi töölauale</Text>

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
    minHeight: 48,
    justifyContent: "center",
  },
  rejectButton: {
    backgroundColor: "#b42318",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 48,
    justifyContent: "center",
  },

  transferButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
  pendingNotice: { color: "#92400e", backgroundColor: "#fffaeb", padding: 8, borderRadius: 8, marginTop: 8 },
  workflowNotice: { color: "#344054", backgroundColor: "#f2f4f7", padding: 8, borderRadius: 8, marginTop: 8 },

  tabs: {

    width: "100%",

  flexDirection: "row",

  flexWrap: "wrap",

  gap: 8,

  marginBottom: 12,

},

  moreTabs: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "#f2f4f7",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },

  tabButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: "center",

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
