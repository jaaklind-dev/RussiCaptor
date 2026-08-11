import * as FileSystem from "expo-file-system/legacy";

import type { ExerciseSession } from "@/models/ExerciseSession";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { ExerciseControlAuditEntry } from "@/models/exercise/ExerciseControlCommand";
import type { InstructorCommandAuditEntry } from "@/models/InstructorCommand";
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
import { clinicalDataProvider, dataProvider } from "@/providers/ProviderFactory";
import { getCanonicalExerciseSnapshot, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { getAllTimelineEvents, restoreTimelineEvents } from "@/repositories/TimelineRepository";
import { getAssignmentState, restoreAssignmentState } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { getCurrentCaseManager, restoreCurrentCaseManager } from "@/services/CurrentUserService";
import { subscribeToSync } from "@/services/SyncService";
import type { CaseManager } from "@/models/CaseManager";
import type { Intervention } from "@/models/Intervention";
import type { MedicationAdministration } from "@/models/Medication";
import type { InstalledWorkbook } from "@/services/WorkbookImportService";
import type { VitalSigns } from "@/models/VitalSigns";
import {
  getInstalledWorkbook,
  restoreInstalledWorkbook,
} from "@/services/WorkbookImportService";
import {
  getCaseManagerLocationState,
  restoreCaseManagerLocationState,
} from "@/services/CurrentLocationService";
import { getExerciseControlAudit, restoreExerciseControlAudit } from "@/services/runtime/exercise/ExerciseControlCommandHandler";
import { getInstructorCommandAudit, restoreInstructorCommandAudit } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import type { ExerciseResetAudit } from "@/services/runtime/exercise/ExerciseResetService";
import {
  getExerciseResetAudit,
  restoreExerciseResetAudit,
} from "@/services/runtime/exercise/ExerciseResetService";
import type { CompletedExerciseArchive } from "@/services/exercise/CompletedExerciseArchiveService";
import { getCompletedExerciseArchives, restoreCompletedExerciseArchives } from "@/services/exercise/CompletedExerciseArchiveService";
import {
  exercisePackageRegistry,
  getExercisePackage,
} from "@/services/exercise/ExercisePackageService";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";

const STATE_VERSION = 1;
const stateFileUri = `${FileSystem.documentDirectory}russicaptor-state.json`;

export type SharedExerciseState = {
  exerciseSession: ExerciseSession | CanonicalExerciseSnapshot;
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
  interventions?: Intervention[];
  medicationAdministrations?: MedicationAdministration[];
  vitalSigns?: VitalSigns[];
  caseManagerZoneIds?: Record<string, string>;
  installedWorkbook?: InstalledWorkbook;
  exerciseControlAudit?: ExerciseControlAuditEntry[];
  instructorCommandAudit?: InstructorCommandAuditEntry[];
  exerciseResetAudit?: ExerciseResetAudit[];
  exercisePackageReference?: { packageId: string; packageVersion: string };
  completedExerciseArchives?: CompletedExerciseArchive[];
};

type PersistedState = SharedExerciseState & {
  version: typeof STATE_VERSION;
  savedAt: string;
  currentCaseManager: CaseManager;
};

let saveChain = Promise.resolve();
let pendingSaveCount = 0;

export type LocalSaveStatus = {
  state: "ready" | "saving" | "saved" | "error";
  savedAt?: string;
};

type LocalSaveListener = (status: LocalSaveStatus) => void;

let localSaveStatus: LocalSaveStatus = { state: "ready" };
const localSaveListeners: LocalSaveListener[] = [];

function setLocalSaveStatus(status: LocalSaveStatus): void {
  localSaveStatus = status;
  localSaveListeners.forEach((listener) => listener(status));
}

export function getLocalSaveStatus(): LocalSaveStatus {
  return { ...localSaveStatus };
}

export function subscribeToLocalSaveStatus(
  listener: LocalSaveListener
): () => void {
  localSaveListeners.push(listener);

  return () => {
    const index = localSaveListeners.indexOf(listener);

    if (index >= 0) {
      localSaveListeners.splice(index, 1);
    }
  };
}

function replaceItems<T>(target: T[], restored: T[]): void {
  target.splice(0, target.length, ...restored.map((item) => ({ ...item })));
}

function createSnapshot(): PersistedState {
  const assignmentState = getAssignmentState();
  const patients = dataProvider.getPatients();
  const questions = clinicalDataProvider.getQuestions();
  const labs = clinicalDataProvider.getLabs();
  const imagingStudies = clinicalDataProvider.getImagingStudies();
  const orders = clinicalDataProvider.getOrders();
  const notes = clinicalDataProvider.getNotes();
  const scenarioEvents = clinicalDataProvider.getScenarioEvents();
  const interventions = clinicalDataProvider.getInterventions();
  const medicationAdministrations =
    clinicalDataProvider.getMedicationAdministrations();
  const vitalSigns = clinicalDataProvider.getVitalSigns();

  return {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    currentCaseManager: { ...getCurrentCaseManager() },
    exerciseSession: getCanonicalExerciseSnapshot(),
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
    interventions: interventions.map((intervention) => ({ ...intervention })),
    medicationAdministrations: medicationAdministrations.map((item) => ({
      ...item,
    })),
    vitalSigns: vitalSigns.map((item) => ({ ...item })),
    caseManagerZoneIds: getCaseManagerLocationState(),
    installedWorkbook: getInstalledWorkbook(),
    exerciseControlAudit: [...getExerciseControlAudit()],
    instructorCommandAudit: [...getInstructorCommandAudit()],
    exerciseResetAudit: [...getExerciseResetAudit()],
    exercisePackageReference: packageReference(),
    completedExerciseArchives: [...getCompletedExerciseArchives()],
  };
}

function packageReference(): { packageId: string; packageVersion: string } {
  const pkg = getExercisePackage(getCanonicalExerciseSnapshot().exerciseId);
  return { packageId: pkg.packageId, packageVersion: pkg.packageVersion };
}

function restoreExerciseIdentity(restored: SharedExerciseState): void {
  const session = restored.exerciseSession; const exerciseId = session.exerciseId;
  const reference = restored.exercisePackageReference;
  const pkg = reference ? exercisePackageRegistry.get(reference.packageId, reference.packageVersion) : undefined;
  installCurrentExercise(exerciseId, pkg?.metadata.name ?? exerciseId, pkg);
  restoreExerciseSession(session);
  restoreCompletedExerciseArchives(restored.completedExerciseArchives ?? []);
}

export function createSharedExerciseSnapshot(): SharedExerciseState {
  const { version: _version, savedAt: _savedAt, currentCaseManager: _currentCaseManager, ...shared } =
    createSnapshot();
  return shared;
}

export function restoreSharedExerciseState(restored: SharedExerciseState): void {
  stopClockRunner();
  restoreInstalledWorkbook(restored.installedWorkbook);
  restoreExerciseIdentity(restored);
  restoreExerciseControlAudit(restored.exerciseControlAudit ?? []);
  restoreInstructorCommandAudit(restored.instructorCommandAudit ?? []);
  restoreExerciseResetAudit(restored.exerciseResetAudit ?? []);
  replaceItems(dataProvider.getPatients(), restored.patients);
  restoreAssignmentState(restored);
  restoreCaseManagerLocationState(restored.caseManagerZoneIds ?? {});
  replaceItems(clinicalDataProvider.getQuestions(), restored.questions);
  replaceItems(clinicalDataProvider.getLabs(), restored.labs);
  replaceItems(clinicalDataProvider.getImagingStudies(), restored.imagingStudies);

  const orders = clinicalDataProvider.getOrders();
  orders.splice(
    0,
    orders.length,
    ...restored.orders.map((order) => ({
      ...order,
      workflow: { ...order.workflow },
    }))
  );

  replaceItems(clinicalDataProvider.getNotes(), restored.notes);
  replaceItems(clinicalDataProvider.getScenarioEvents(), restored.scenarioEvents);
  restoreTimelineEvents(restored.timelineEvents);
  replaceItems(clinicalDataProvider.getInterventions(), restored.interventions ?? []);
  replaceItems(
    clinicalDataProvider.getMedicationAdministrations(),
    restored.medicationAdministrations ?? []
  );
  if (restored.vitalSigns) {
    replaceItems(clinicalDataProvider.getVitalSigns(), restored.vitalSigns);
  }

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

    setLocalSaveStatus({ state: "saved", savedAt: restored.savedAt });

    restoreInstalledWorkbook(restored.installedWorkbook);
    restoreCurrentCaseManager(restored.currentCaseManager);
    restoreExerciseIdentity(restored);
    restoreExerciseControlAudit(restored.exerciseControlAudit ?? []);
    restoreInstructorCommandAudit(restored.instructorCommandAudit ?? []);
    restoreExerciseResetAudit(restored.exerciseResetAudit ?? []);
    replaceItems(dataProvider.getPatients(), restored.patients);
    restoreAssignmentState(restored);
    restoreCaseManagerLocationState(restored.caseManagerZoneIds ?? {});
    replaceItems(clinicalDataProvider.getQuestions(), restored.questions);
    replaceItems(clinicalDataProvider.getLabs(), restored.labs);
    replaceItems(
      clinicalDataProvider.getImagingStudies(),
      restored.imagingStudies
    );
    const orders = clinicalDataProvider.getOrders();
    orders.splice(
      0,
      orders.length,
      ...restored.orders.map((order) => ({
        ...order,
        workflow: { ...order.workflow },
      }))
    );
    replaceItems(clinicalDataProvider.getNotes(), restored.notes);
    replaceItems(
      clinicalDataProvider.getScenarioEvents(),
      restored.scenarioEvents
    );
    restoreTimelineEvents(restored.timelineEvents);
    replaceItems(
      clinicalDataProvider.getInterventions(),
      restored.interventions ?? []
    );
    replaceItems(
      clinicalDataProvider.getMedicationAdministrations(),
      restored.medicationAdministrations ?? []
    );
    if (restored.vitalSigns) {
      replaceItems(clinicalDataProvider.getVitalSigns(), restored.vitalSigns);
    }

  } catch (error) {
    console.warn("Saved exercise state could not be loaded.", error);
  }
}

export function startStatePersistence(): () => void {
  return subscribeToSync(() => {
    const snapshot = createSnapshot();
    pendingSaveCount += 1;

    setLocalSaveStatus({
      state: "saving",
      savedAt: localSaveStatus.savedAt,
    });

    saveChain = saveChain
      .then(() =>
        FileSystem.writeAsStringAsync(stateFileUri, JSON.stringify(snapshot))
      )
      .then(() => {
        pendingSaveCount -= 1;

        if (pendingSaveCount === 0) {
          setLocalSaveStatus({ state: "saved", savedAt: snapshot.savedAt });
        }
      })
      .catch((error) => {
        pendingSaveCount = Math.max(0, pendingSaveCount - 1);
        setLocalSaveStatus({
          state: "error",
          savedAt: localSaveStatus.savedAt,
        });
        console.warn("Exercise state could not be saved.", error);
      });
  });
}
