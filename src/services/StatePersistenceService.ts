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
import { startClockRunner, stopClockRunner } from "@/services/ClockRunner";
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
import type { MaterializedPatientDataset } from "@/models/exercise/PackagePatientDataset";
import { getPatientMaterialization, restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import type { PersistedRuntimeState } from "@/models/PersistedRuntimeState";
import { captureActiveClinicalReferenceRuntimes, prepareActiveClinicalReferenceRuntime } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";

const STATE_VERSION = 1;
const stateFileUri = `${FileSystem.documentDirectory}russicaptor-state.json`;
const stateTempFileUri = `${FileSystem.documentDirectory}russicaptor-state.tmp.json`;

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
  patientMaterialization?: MaterializedPatientDataset;
  persistedRuntimeStates?: readonly PersistedRuntimeState[];
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
  const exerciseSession = getCanonicalExerciseSnapshot();
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
  const persistedRuntimeStates = captureActiveClinicalReferenceRuntimes(exerciseSession.simulationTimeSec);

  return {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    currentCaseManager: { ...getCurrentCaseManager() },
    exerciseSession,
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
    patientMaterialization: getPatientMaterialization(getCanonicalExerciseSnapshot().exerciseId),
    persistedRuntimeStates,
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
  restorePatientMaterialization(restored.patientMaterialization);
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

  restoreCanonicalRuntime(restored);

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

    restoreCanonicalRuntime(restored);

  } catch (error) {
    console.warn("Saved exercise state could not be loaded.", error);
  }
}

function restoreCanonicalRuntime(restored: SharedExerciseState): void {
  const session = restored.exerciseSession;
  const lifecycleState = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycleState === "RUNNING" || lifecycleState === "PAUSED") {
    if (!restored.persistedRuntimeStates?.length) throw new Error("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
    const simulationTimeSec = "simulationTimeSec" in session ? session.simulationTimeSec : session.currentMinute * 60;
    if (restored.persistedRuntimeStates.some(item => item.capturedAtSimulationTimeSec !== simulationTimeSec)) {
      throw new Error("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
    }
    prepareActiveClinicalReferenceRuntime(session.exerciseId, restored.persistedRuntimeStates);
    if (lifecycleState === "RUNNING") startClockRunner();
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
      .then(async () => {
        await FileSystem.writeAsStringAsync(stateTempFileUri, JSON.stringify(snapshot));
        await FileSystem.moveAsync({ from: stateTempFileUri, to: stateFileUri });
      })
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
