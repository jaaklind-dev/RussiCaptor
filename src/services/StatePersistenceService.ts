import * as FileSystem from "expo-file-system/legacy";

import { clinicalDataProvider, dataProvider } from "@/providers/ProviderFactory";
import { getCanonicalExerciseSnapshot, restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { getAllTimelineEvents, restoreTimelineEvents } from "@/repositories/TimelineRepository";
import { getAssignmentState, restoreAssignmentState } from "@/services/AssignmentRepository";
import { startClockRunner, stopClockRunner } from "@/services/ClockRunner";
import { getCurrentCaseManager, restoreCurrentCaseManager } from "@/services/CurrentUserService";
import { subscribeToSync } from "@/services/SyncService";
import type { CaseManager } from "@/models/CaseManager";
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
import {
  getExerciseResetAudit,
  restoreExerciseResetAudit,
} from "@/services/runtime/exercise/ExerciseResetService";
import { getCompletedExerciseArchives, restoreCompletedExerciseArchives } from "@/services/exercise/CompletedExerciseArchiveService";
import {
  exercisePackageRegistry,
  getExercisePackage,
} from "@/services/exercise/ExercisePackageService";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";
import { getPatientMaterialization, restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import { captureActiveClinicalReferenceRuntimes, captureActiveClinicalReferenceRuntimesAsync, clearActiveClinicalReferenceRuntime, prepareActiveClinicalReferenceRuntime } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import { localRuntimeCheckpointStore } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { BoundedObsoleteGenerationGate, LatestGenerationPipeline } from "@/services/runtime/persistence/LatestGenerationPipeline";

const STATE_VERSION = 1;
const stateFileUri = `${FileSystem.documentDirectory}russicaptor-state.json`;
const stateTempFileUri = `${FileSystem.documentDirectory}russicaptor-state.tmp.json`;

export type { SharedExerciseState } from "@/models/SharedExerciseState";

type PersistedState = SharedExerciseState & {
  version: typeof STATE_VERSION;
  savedAt: string;
  currentCaseManager: CaseManager;
  runtimeCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>;
};

let saveInFlight = false;
let pendingSnapshot: PersistedState | undefined;
const checkpointPreparedListeners = new Set<() => void>();

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

function collectSharedExerciseProjection(): SharedExerciseState {
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
  return {
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
  };
}

function collectSharedExerciseState(): SharedExerciseState {
  const shared = collectSharedExerciseProjection();
  const simulationTimeSec = "simulationTimeSec" in shared.exerciseSession
    ? shared.exerciseSession.simulationTimeSec : shared.exerciseSession.currentMinute * 60;
  return { ...shared, persistedRuntimeStates: captureActiveClinicalReferenceRuntimes(simulationTimeSec) };
}

async function collectSharedExerciseStateAsync(yieldControl: () => Promise<void>): Promise<SharedExerciseState> {
  const shared = collectSharedExerciseProjection();
  const simulationTimeSec = "simulationTimeSec" in shared.exerciseSession
    ? shared.exerciseSession.simulationTimeSec : shared.exerciseSession.currentMinute * 60;
  const persistedRuntimeStates = await captureActiveClinicalReferenceRuntimesAsync(
    simulationTimeSec,
    yieldControl,
  );
  return { ...shared, persistedRuntimeStates };
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
  return collectSharedExerciseState();
}

/** Discovery/UI projection. Active canonical Runtime is checkpoint-owned. */
export function createSharedExerciseProjection(): SharedExerciseState {
  return collectSharedExerciseProjection();
}

export function subscribeToLocalRuntimeCheckpointPrepared(listener: () => void): () => void {
  checkpointPreparedListeners.add(listener);
  return () => checkpointPreparedListeners.delete(listener);
}

/** Active shared rows expose discovery identity only; canonical Runtime is restored from WP-44B checkpoint. */
export function restoreRemoteExerciseIdentity(restored: SharedExerciseState): void {
  // During clean startup the shared exercise row is discovery identity only.
  // Until checkpoint authority is resolved, no previously restored live Runtime
  // may be combined with that projection, even when the exercise ID matches.
  // A confirmed writer keeps its canonical Runtime when receiving its own cloud
  // projection echo.
  if (getRuntimeWriterAuthorityState() !== "WRITER") {
    stopClockRunner();
    clearActiveClinicalReferenceRuntime();
  }
  restoreExerciseIdentity(restored);
}

export function getLocalRuntimeCheckpoint(): RuntimeCheckpointEnvelope<SharedExerciseState> | undefined {
  return localRuntimeCheckpointStore.get();
}

export function ensureLocalRuntimeCheckpoint(): RuntimeCheckpointEnvelope<SharedExerciseState> {
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  const current = localRuntimeCheckpointStore.get();
  return current?.exerciseId === exerciseId
    ? current
    : localRuntimeCheckpointStore.capture(collectSharedExerciseState());
}

export function acceptAuthoritativeRuntimeCheckpoint(checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>, startRuntime = false): void {
  assertRuntimeCheckpointClockConsistency(checkpoint.payload);
  restoreSharedExerciseState(checkpoint.payload, startRuntime);
  // The resolver has already selected this valid remote envelope as canonical.
  // Replace a checkpoint from another exercise only after rehydration succeeds.
  localRuntimeCheckpointStore.restore(checkpoint);
  setRuntimePersistenceFailure(undefined);
}

export function assertRuntimeCheckpointClockConsistency(restored: SharedExerciseState): void {
  const session = restored.exerciseSession;
  const lifecycleState = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycleState !== "RUNNING" && lifecycleState !== "PAUSED") return;
  if (!restored.persistedRuntimeStates?.length) throw new Error("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  const simulationTimeSec = "simulationTimeSec" in session ? session.simulationTimeSec : session.currentMinute * 60;
  if (restored.persistedRuntimeStates.some(item =>
    item.capturedAtSimulationTimeSec !== simulationTimeSec ||
    item.payload.simulationTimeSec !== item.capturedAtSimulationTimeSec
  )) throw new Error("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
}

export function restoreSharedExerciseState(restored: SharedExerciseState, startRuntime = true): void {
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

  restoreCanonicalRuntime(restored, startRuntime);

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

    localRuntimeCheckpointStore.restore(restored.runtimeCheckpoint);

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

    restoreCanonicalRuntime(restored, true);
    setRuntimePersistenceFailure(undefined);

  } catch (error) {
    if (error instanceof Error && error.message === "ACTIVE_RUNTIME_PERSISTENCE_MISSING") {
      setRuntimePersistenceFailure({ code: "ACTIVE_RUNTIME_PERSISTENCE_MISSING", exerciseId: getCanonicalExerciseSnapshot().exerciseId });
    }
    console.warn("Saved exercise state could not be loaded.", error);
  }
}

function restoreCanonicalRuntime(restored: SharedExerciseState, startRuntime: boolean): void {
  const session = restored.exerciseSession;
  const lifecycleState = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycleState === "RUNNING" || lifecycleState === "PAUSED") {
    assertRuntimeCheckpointClockConsistency(restored);
    prepareActiveClinicalReferenceRuntime(session.exerciseId, restored.persistedRuntimeStates);
    if (lifecycleState === "RUNNING" && startRuntime) startClockRunner();
  }
}

export function startStatePersistence(): () => void {
  let stopped = false;
  const obsoleteGate = new BoundedObsoleteGenerationGate();
  const pipeline = new LatestGenerationPipeline(async (generation, yieldControl) => {
    try {
      const shared = await collectSharedExerciseStateAsync(yieldControl);
      if (stopped) return;
      await yieldControl();
      const hasCanonicalRuntime = (shared.persistedRuntimeStates?.length ?? 0) > 0;
      const preparedCheckpoint = hasCanonicalRuntime
        ? await localRuntimeCheckpointStore.prepareCaptureAsync(shared, yieldControl)
        : undefined;
      // Drop one obsolete preparation, but force the next one through CAS so a
      // continuously ticking Runtime cannot starve checkpoint publication.
      if (stopped || obsoleteGate.shouldDrop(pipeline.isCurrent(generation))) return;
      if (preparedCheckpoint && !localRuntimeCheckpointStore.commitPrepared(preparedCheckpoint)) {
        pipeline.request();
        return;
      }
      // Commit and publication notification form one synchronous boundary so
      // a newer generation cannot make the committed checkpoint obsolete.
      const snapshot: PersistedState = {
        ...shared,
        version: STATE_VERSION,
        savedAt: new Date().toISOString(),
        currentCaseManager: { ...getCurrentCaseManager() },
        ...(preparedCheckpoint ? { runtimeCheckpoint: preparedCheckpoint } : {}),
      };
      pendingSnapshot = snapshot;
      setLocalSaveStatus({ state: "saving", savedAt: localSaveStatus.savedAt });
      checkpointPreparedListeners.forEach(listener => listener());
      await yieldControl();
      void flushLatestSnapshot();
    } catch (error) {
      // A partially restored active Runtime must never be persisted. The
      // authority resolver may still replace it with a valid remote checkpoint.
      setLocalSaveStatus({ state: "error", savedAt: localSaveStatus.savedAt });
      console.warn("Exercise state snapshot was rejected.", error);
    }
  });
  const unsubscribe = subscribeToSync(() => pipeline.request());
  return () => { stopped = true; unsubscribe(); };
}

async function flushLatestSnapshot(): Promise<void> {
  if (saveInFlight) return;
  saveInFlight = true;
  try {
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = undefined;
      await FileSystem.writeAsStringAsync(stateTempFileUri, JSON.stringify(snapshot));
      await FileSystem.moveAsync({ from: stateTempFileUri, to: stateFileUri });
      if (!pendingSnapshot) setLocalSaveStatus({ state: "saved", savedAt: snapshot.savedAt });
    }
  } catch (error) {
    setLocalSaveStatus({ state: "error", savedAt: localSaveStatus.savedAt });
    console.warn("Exercise state could not be saved.", error);
  } finally {
    saveInFlight = false;
    if (pendingSnapshot) void flushLatestSnapshot();
  }
}
