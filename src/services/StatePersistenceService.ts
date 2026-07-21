import * as FileSystem from "expo-file-system/legacy";

import { imagingStudies } from "@/data/imaging";
import { labs } from "@/data/labs";
import { notes } from "@/data/notes";
import { orders } from "@/data/orders";
import { patients } from "@/data/patients";
import { questions } from "@/data/questions";
import { scenarioEvents } from "@/data/scenarioEvents";
import type { ExerciseSession } from "@/models/ExerciseSession";
import type { ImagingStudy } from "@/models/ImagingStudy";
import type { LabResult } from "@/models/LabResult";
import type { Note } from "@/models/Note";
import type { Order } from "@/models/Order";
import type { Patient } from "@/models/Patient";
import type { PatientAssignment } from "@/models/PatientAssignment";
import type { PatientTransfer } from "@/models/PatientTransfer";
import type { Question } from "@/models/Question";
import type { ScenarioEvent } from "@/models/ScenarioEvent";
import type { TimelineEvent } from "@/models/TimelineEvent";
import { getExerciseSession, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { getAllTimelineEvents, restoreTimelineEvents } from "@/repositories/TimelineRepository";
import { getAssignmentState, restoreAssignmentState } from "@/services/AssignmentRepository";
import { startClockRunner } from "@/services/ClockRunner";
import { getCurrentCaseManager, restoreCurrentCaseManager } from "@/services/CurrentUserService";
import { subscribeToSync } from "@/services/SyncService";
import type { CaseManager } from "@/models/CaseManager";

const STATE_VERSION = 1;
const stateFileUri = `${FileSystem.documentDirectory}russicaptor-state.json`;

type PersistedState = {
  version: typeof STATE_VERSION;
  savedAt: string;
  currentCaseManager: CaseManager;
  exerciseSession: ExerciseSession;
  patients: Patient[];
  assignments: PatientAssignment[];
  transfers: PatientTransfer[];
  questions: Question[];
  labs: LabResult[];
  imagingStudies: ImagingStudy[];
  orders: Order[];
  notes: Note[];
  scenarioEvents: ScenarioEvent[];
  timelineEvents: TimelineEvent[];
};

let saveChain = Promise.resolve();

function replaceItems<T>(target: T[], restored: T[]): void {
  target.splice(0, target.length, ...restored.map((item) => ({ ...item })));
}

function createSnapshot(): PersistedState {
  const assignmentState = getAssignmentState();

  return {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    currentCaseManager: { ...getCurrentCaseManager() },
    exerciseSession: { ...getExerciseSession() },
    patients: patients.map((patient) => ({ ...patient, mist: { ...patient.mist } })),
    assignments: assignmentState.assignments,
    transfers: assignmentState.transfers,
    questions: questions.map((question) => ({ ...question })),
    labs: labs.map((lab) => ({ ...lab })),
    imagingStudies: imagingStudies.map((study) => ({ ...study })),
    orders: orders.map((order) => ({ ...order, workflow: { ...order.workflow } })),
    notes: notes.map((note) => ({ ...note })),
    scenarioEvents: scenarioEvents.map((event) => ({ ...event })),
    timelineEvents: getAllTimelineEvents(),
  };
}

export async function loadPersistedState(): Promise<void> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(stateFileUri);

    if (!fileInfo.exists) {
      return;
    }

    const restored = JSON.parse(
      await FileSystem.readAsStringAsync(stateFileUri)
    ) as PersistedState;

    if (restored.version !== STATE_VERSION) {
      return;
    }

    restoreCurrentCaseManager(restored.currentCaseManager);
    restoreExerciseSession(restored.exerciseSession);
    replaceItems(patients, restored.patients);
    restoreAssignmentState(restored);
    replaceItems(questions, restored.questions);
    replaceItems(labs, restored.labs);
    replaceItems(imagingStudies, restored.imagingStudies);
    orders.splice(
      0,
      orders.length,
      ...restored.orders.map((order) => ({
        ...order,
        workflow: { ...order.workflow },
      }))
    );
    replaceItems(notes, restored.notes);
    replaceItems(scenarioEvents, restored.scenarioEvents);
    restoreTimelineEvents(restored.timelineEvents);

    if (restored.exerciseSession.state === "running") {
      startClockRunner();
    }
  } catch (error) {
    console.warn("Saved exercise state could not be loaded.", error);
  }
}

export function startStatePersistence(): () => void {
  return subscribeToSync(() => {
    const snapshot = createSnapshot();

    saveChain = saveChain
      .then(() =>
        FileSystem.writeAsStringAsync(stateFileUri, JSON.stringify(snapshot))
      )
      .catch((error) => {
        console.warn("Exercise state could not be saved.", error);
      });
  });
}
