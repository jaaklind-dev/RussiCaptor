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
import { restoreCompletedExerciseArchives } from "@/services/exercise/CompletedExerciseArchiveService";
import {
  exercisePackageRegistry,
  exercisePackageLoader,
  getExercisePackage,
} from "@/services/exercise/ExercisePackageService";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";
import { getPatientMaterialization, restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import { captureActiveClinicalReferenceRuntimes, captureActiveClinicalReferenceRuntimesAsync, clearActiveClinicalReferenceRuntime, fenceActiveLaboratoryWorkflowsAtTerminal, getActiveClinicalReferenceRuntimeClocks, isClinicalReferenceRuntimeReadReady, prepareActiveClinicalReferenceRuntime, prepareActiveClinicalReferenceRuntimeAsync } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import type { RuntimeCheckpointCanonicalRepresentation, RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import {
  getRuntimeCheckpointCanonicalRepresentation,
  localRuntimeCheckpointStore,
  restoreRuntimeCheckpointCanonicalRepresentation,
} from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getRuntimeWriterAuthorityState, runtimeWritesAllowed, type RuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { setRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { BoundedObsoleteGenerationGate, LatestGenerationPipeline, yieldToEventLoop, type PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { capturePatientTransportRuntime, preparePatientTransportRuntime } from "@/services/runtime/exercise/PatientTransportRuntimeService";
import { compactActiveExerciseState } from "@/services/runtime/persistence/ActiveCheckpointCompaction";
import { startRuntimeWorkTrace, traceRuntimeLeaseLifecycle } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { RuntimeCheckpointClockMismatchError, terminalClockReconciliationDecision } from
  "@/services/runtime/persistence/RuntimeTerminalClockReconciliation";
import {
  getRuntimeCompletionCheckpointIntent,
  installRuntimeCompletionIntentListener,
} from "@/services/runtime/persistence/RuntimeCheckpointLifecycleIntent";
import { getRuntimeCompletionPhase } from "@/services/runtime/exercise/RuntimeCompletionService";
import { restorePersistedImportedExercisePackages } from "@/services/import/ImportedExercisePackageRegistry";
import { getRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from "@/services/runtime/commands/RuntimePatientCommandCursor";

const STATE_VERSION = 1;
const stateFileUri = `${FileSystem.documentDirectory}russicaptor-state.json`;
const stateTempFileUri = `${FileSystem.documentDirectory}russicaptor-state.tmp.json`;

export type { SharedExerciseState } from "@/models/SharedExerciseState";

type PersistedState = SharedExerciseState & {
  version: typeof STATE_VERSION;
  savedAt: string;
  currentCaseManager: CaseManager;
  runtimeCheckpoint?: RuntimeCheckpointEnvelope<SharedExerciseState>;
  runtimeCheckpointCanonical?: RuntimeCheckpointCanonicalRepresentation;
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
  return compactActiveExerciseState({
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
    patientMaterialization: getPatientMaterialization(getCanonicalExerciseSnapshot().exerciseId),
    patientTransportRuntime: capturePatientTransportRuntime(),
  });
}

function collectSharedExerciseState(): SharedExerciseState {
  const shared = collectSharedExerciseProjection();
  const simulationTimeSec = "simulationTimeSec" in shared.exerciseSession
    ? shared.exerciseSession.simulationTimeSec : shared.exerciseSession.currentMinute * 60;
  if ("lifecycleState" in shared.exerciseSession && shared.exerciseSession.lifecycleState === "COMPLETED") {
    fenceActiveLaboratoryWorkflowsAtTerminal(shared.exerciseSession.exerciseId, simulationTimeSec);
  }
  const runtimePatientCommandCursor = getRuntimePatientCommandCursor(shared.exerciseSession.exerciseId);
  return { ...shared, persistedRuntimeStates: captureActiveClinicalReferenceRuntimes(simulationTimeSec, shared.exerciseSession.exerciseId),
    ...(runtimePatientCommandCursor > 0 ? { runtimePatientCommandCursor } : {}) };
}

export type CheckpointEnvelopePreparationDecision = Readonly<{
  eligible: boolean;
  reason: "READY" | "NO_CANONICAL_RUNTIME" | "RUNTIME_WRITES_NOT_ALLOWED";
}>;

export function checkpointEnvelopePreparationDecision(
  persistedRuntimeCount: number,
  writesAllowed: boolean,
): CheckpointEnvelopePreparationDecision {
  if (persistedRuntimeCount < 1) return Object.freeze({ eligible: false, reason: "NO_CANONICAL_RUNTIME" });
  if (!writesAllowed) return Object.freeze({ eligible: false, reason: "RUNTIME_WRITES_NOT_ALLOWED" });
  return Object.freeze({ eligible: true, reason: "READY" });
}

async function collectSharedExerciseStateAsync(yieldControl: () => Promise<void>): Promise<SharedExerciseState> {
  const endSnapshot = startRuntimeWorkTrace("PRE_CANON_SNAPSHOT");
  const endCollection = startRuntimeWorkTrace("CHECKPOINT_PROJECTION_COLLECTION");
  const shared = collectSharedExerciseProjection();
  endCollection({
    patientCount: shared.patients.length,
    scenarioEventCount: shared.scenarioEvents.length,
    timelineEventCount: shared.timelineEvents.length,
  });
  endSnapshot({ stage: "projection" });
  const simulationTimeSec = "simulationTimeSec" in shared.exerciseSession
    ? shared.exerciseSession.simulationTimeSec : shared.exerciseSession.currentMinute * 60;
  if ("lifecycleState" in shared.exerciseSession && shared.exerciseSession.lifecycleState === "COMPLETED") {
    fenceActiveLaboratoryWorkflowsAtTerminal(shared.exerciseSession.exerciseId, simulationTimeSec);
  }
  const endMaterialize = startRuntimeWorkTrace("PRE_CANON_MATERIALIZE", {
    simulationTimeSec,
  });
  const persistedRuntimeStates = await captureActiveClinicalReferenceRuntimesAsync(
    simulationTimeSec,
    yieldControl,
    shared.exerciseSession.exerciseId,
  );
  endMaterialize({ persistedRuntimeCount: persistedRuntimeStates.length });
  const endAssembly = startRuntimeWorkTrace("PRE_CANON_ASSEMBLY", {
    persistedRuntimeCount: persistedRuntimeStates.length,
  });
  const runtimePatientCommandCursor = getRuntimePatientCommandCursor(shared.exerciseSession.exerciseId);
  const result = { ...shared, persistedRuntimeStates,
    ...(runtimePatientCommandCursor > 0 ? { runtimePatientCommandCursor } : {}) };
  endAssembly();
  return result;
}

function packageReference(): { packageId: string; packageVersion: string } {
  const pkg = getExercisePackage(getCanonicalExerciseSnapshot().exerciseId);
  return { packageId: pkg.packageId, packageVersion: pkg.packageVersion };
}

function restoreExerciseIdentity(restored: SharedExerciseState, restoreArchives = true): void {
  const session = restored.exerciseSession; const exerciseId = session.exerciseId;
  const reference = restored.exercisePackageReference;
  const pkg = reference ? exercisePackageRegistry.get(reference.packageId, reference.packageVersion) : undefined;
  if (reference && !pkg) throw new Error("EXERCISE_PACKAGE_UNAVAILABLE");
  installCurrentExercise(exerciseId, pkg?.metadata.name ?? exerciseId, pkg);
  restoreExerciseSession(session);
  if (restoreArchives) restoreCompletedExerciseArchives(restored.completedExerciseArchives ?? []);
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
export function shouldClearRuntimeForRemoteIdentity(authority: RuntimeWriterAuthorityState,
  sameExerciseReaderIsHydrated: boolean): boolean {
  return authority !== "WRITER" && !(authority === "READER" && sameExerciseReaderIsHydrated);
}

export function shouldPreserveValidatedReaderIdentity(authority: RuntimeWriterAuthorityState,
  sameExerciseReaderIsHydrated: boolean): boolean {
  return authority === "READER" && sameExerciseReaderIsHydrated;
}

/**
 * A discovery row carries identity only.  It must not erase a fully prepared,
 * same-exercise Runtime before checkpoint authority has had its first chance
 * to resolve.  This does not grant write authority: the guarded writer CAS is
 * still the only path to WRITER, and an existing remote checkpoint replaces
 * this seed during normal checkpoint resolution.
 */
export function shouldPreserveFreshRuntimeBootstrapSeed(input: Readonly<{
  authority: RuntimeWriterAuthorityState;
  localExerciseId: string;
  remoteExerciseId: string;
  localPackageId?: string;
  localPackageVersion?: string;
  remotePackageId?: string;
  remotePackageVersion?: string;
  patientMaterializationReady: boolean;
  runtimeReady: boolean;
}>): boolean {
  return input.authority === "UNRESOLVED"
    && input.localExerciseId === input.remoteExerciseId
    && Boolean(input.localPackageId && input.localPackageVersion)
    && input.localPackageId === input.remotePackageId
    && input.localPackageVersion === input.remotePackageVersion
    && input.patientMaterializationReady
    && input.runtimeReady;
}

const readerRuntimeHydrationCounts = new Map<string, number>();

function isReaderRuntimeHydrationInProgress(exerciseId: string): boolean {
  return (readerRuntimeHydrationCounts.get(exerciseId) ?? 0) > 0;
}

export function restoreRemoteExerciseIdentity(restored: SharedExerciseState): void {
  // During clean startup the shared exercise row is discovery identity only.
  // Until checkpoint authority is resolved, no previously restored live Runtime
  // may be combined with that projection, even when the exercise ID matches.
  // A confirmed writer keeps its canonical Runtime when receiving its own cloud
  // projection echo.
  const authority = getRuntimeWriterAuthorityState();
  const localExercise = getCanonicalExerciseSnapshot();
  const localPackage = exercisePackageLoader.getBound(localExercise.exerciseId);
  const remotePackage = restored.exercisePackageReference;
  const preserveFreshBootstrapSeed = shouldPreserveFreshRuntimeBootstrapSeed({
    authority,
    localExerciseId: localExercise.exerciseId,
    remoteExerciseId: restored.exerciseSession.exerciseId,
    localPackageId: localPackage?.packageId,
    localPackageVersion: localPackage?.packageVersion,
    remotePackageId: remotePackage?.packageId,
    remotePackageVersion: remotePackage?.packageVersion,
    patientMaterializationReady: Boolean(getPatientMaterialization(localExercise.exerciseId)?.patients.length),
    runtimeReady: isClinicalReferenceRuntimeReadReady(localExercise.exerciseId),
  });
  const sameExerciseReaderIsHydrated = authority === "READER"
    && (isClinicalReferenceRuntimeReadReady(restored.exerciseSession.exerciseId)
      || isReaderRuntimeHydrationInProgress(restored.exerciseSession.exerciseId));
  // A validated same-exercise checkpoint owns the reader's canonical clock
  // and Runtime. A bounded discovery row may lag far behind it, so ignore that
  // active projection wholesale instead of restoring its older session clock.
  if (shouldPreserveValidatedReaderIdentity(authority, sameExerciseReaderIsHydrated)
      || preserveFreshBootstrapSeed) return;
  if (shouldClearRuntimeForRemoteIdentity(authority, sameExerciseReaderIsHydrated)) {
    stopClockRunner();
    clearActiveClinicalReferenceRuntime();
  }
  restoreExerciseIdentity(restored, false);
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
  const endValidate = startRuntimeWorkTrace("STARTUP_CHECKPOINT_VALIDATE", {
    checkpointRevision: checkpoint.checkpointRevision,
    persistedRuntimeCount: checkpoint.payload.persistedRuntimeStates?.length ?? 0,
  });
  assertRuntimeCheckpointClockConsistency(checkpoint.payload);
  endValidate();
  const endRehydrate = startRuntimeWorkTrace("STARTUP_RUNTIME_REHYDRATE", {
    persistedRuntimeCount: checkpoint.payload.persistedRuntimeStates?.length ?? 0,
    scenarioEventCount: checkpoint.payload.scenarioEvents.length,
  });
  restoreSharedExerciseState(checkpoint.payload, startRuntime);
  endRehydrate();
  // The resolver has already selected this valid remote envelope as canonical.
  // Replace a checkpoint from another exercise only after rehydration succeeds.
  const endCacheAccept = startRuntimeWorkTrace("STARTUP_CHECKPOINT_CACHE_ACCEPT", {
    checkpointRevision: checkpoint.checkpointRevision,
  });
  localRuntimeCheckpointStore.restore(checkpoint);
  endCacheAccept();
  const savedAt = new Date().toISOString();
  pendingSnapshot = {
    ...checkpoint.payload,
    version: STATE_VERSION,
    savedAt,
    currentCaseManager: { ...getCurrentCaseManager() },
    ...(getRuntimeCheckpointCanonicalRepresentation(checkpoint)
      ? { runtimeCheckpointCanonical: getRuntimeCheckpointCanonicalRepresentation(checkpoint) }
      : { runtimeCheckpoint: checkpoint }),
  };
  setLocalSaveStatus({ state: "saving", savedAt: localSaveStatus.savedAt });
  void flushLatestSnapshot();
  setRuntimePersistenceFailure(undefined);
}

export async function acceptAuthoritativeRuntimeCheckpointAsync(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  startRuntime = false,
  yieldControl: PipelineYield = yieldToEventLoop,
): Promise<void> {
  assertRuntimeCheckpointClockConsistency(checkpoint.payload);
  await restoreSharedExerciseStateAsync(checkpoint.payload, startRuntime, yieldControl);
  localRuntimeCheckpointStore.restore(checkpoint);
  const savedAt = new Date().toISOString();
  pendingSnapshot = { ...checkpoint.payload, version: STATE_VERSION, savedAt,
    currentCaseManager: { ...getCurrentCaseManager() },
    ...(getRuntimeCheckpointCanonicalRepresentation(checkpoint)
      ? { runtimeCheckpointCanonical: getRuntimeCheckpointCanonicalRepresentation(checkpoint) }
      : { runtimeCheckpoint: checkpoint }) };
  setLocalSaveStatus({ state: "saving", savedAt: localSaveStatus.savedAt });
  void flushLatestSnapshot();
}

/**
 * A validated reader checkpoint is rebuilt cooperatively. While that atomic
 * rebuild is in progress, a same-exercise discovery projection must not clear
 * the private Runtime candidates or the transport state prepared from the
 * checkpoint. This grants no writer capability; all Runtime mutations remain
 * guarded by RuntimeWriterAuthorityState.
 */
export async function acceptAuthoritativeRuntimeCheckpointForReaderAsync(
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState>,
  yieldControl: PipelineYield = yieldToEventLoop,
): Promise<void> {
  const exerciseId = checkpoint.exerciseId;
  readerRuntimeHydrationCounts.set(exerciseId, (readerRuntimeHydrationCounts.get(exerciseId) ?? 0) + 1);
  try {
    await acceptAuthoritativeRuntimeCheckpointAsync(checkpoint, false, yieldControl);
  } finally {
    const remaining = (readerRuntimeHydrationCounts.get(exerciseId) ?? 1) - 1;
    if (remaining > 0) readerRuntimeHydrationCounts.set(exerciseId, remaining);
    else readerRuntimeHydrationCounts.delete(exerciseId);
  }
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
  restoreSharedExerciseCollections(restored);
  restoreCanonicalRuntime(restored, startRuntime);
}

export async function restoreSharedExerciseStateAsync(
  restored: SharedExerciseState,
  startRuntime = true,
  yieldControl: PipelineYield = yieldToEventLoop,
): Promise<void> {
  restoreSharedExerciseCollections(restored);
  await restoreCanonicalRuntimeAsync(restored, startRuntime, yieldControl);
}

function restoreSharedExerciseCollections(restored: SharedExerciseState): void {
  stopClockRunner();
  restoreInstalledWorkbook(restored.installedWorkbook);
  restoreExerciseIdentity(restored);
  restoreRuntimePatientCommandCursor(restored.exerciseSession.exerciseId, restored.runtimePatientCommandCursor);
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

/**
 * The durable checkpoint is the only source whose Runtime artifacts have
 * passed full checkpoint validation. Local snapshot rows remain the source
 * for every other restored projection field.
 */
export function runtimeRestoreSource(
  restored: SharedExerciseState,
  validatedCheckpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): SharedExerciseState {
  return validatedCheckpoint?.exerciseId === restored.exerciseSession.exerciseId
    ? validatedCheckpoint.payload
    : restored;
}

export async function loadPersistedState(): Promise<void> {
  try {
    // Imported package definitions are required to bind a validated checkpoint
    // to its exact package after a cold process restart. Re-register them before
    // any exercise identity or Runtime artifact is restored.
    restorePersistedImportedExercisePackages();
    const fileInfo = await FileSystem.getInfoAsync(stateFileUri);

    if (!fileInfo.exists) {
      return;
    }

    const endRead = startRuntimeWorkTrace("STARTUP_LOCAL_STATE_READ");
    const serialized = await FileSystem.readAsStringAsync(stateFileUri);
    endRead({ serializedBytes: serialized.length });
    const endParse = startRuntimeWorkTrace("STARTUP_LOCAL_STATE_PARSE", {
      serializedBytes: serialized.length,
    });
    const restored = JSON.parse(serialized) as PersistedState;
    endParse();

    if (restored.version !== STATE_VERSION) {
      return;
    }

    const endRestore = startRuntimeWorkTrace("STARTUP_LOCAL_STATE_RESTORE", {
      patientCount: restored.patients.length,
      scenarioEventCount: restored.scenarioEvents.length,
      persistedRuntimeCount: restored.persistedRuntimeStates?.length ?? 0,
    });
    const endIdentity = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_IDENTITY");
    const endLocalCheckpoint = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_CHECKPOINT_CACHE");
    if (restored.runtimeCheckpointCanonical) {
      const checkpoint = await restoreRuntimeCheckpointCanonicalRepresentation(
        restored.runtimeCheckpointCanonical,
        () => new Promise(resolve => setTimeout(resolve, 0)),
      );
      await localRuntimeCheckpointStore.restoreAsync(checkpoint, () => new Promise(resolve => setTimeout(resolve, 0)));
    }
    // Legacy local checkpoint payloads remain preserved in the snapshot, but
    // are not synchronously recanonicalized before durable remote discovery.
    // A remote legacy fallback can still validate them when no canonical
    // artifact exists; command readiness remains fenced in the meantime.
    const validatedLocal = localRuntimeCheckpointStore.get();
    const runtimeRestore = runtimeRestoreSource(restored, validatedLocal);
    endLocalCheckpoint();

    setLocalSaveStatus({ state: "saved", savedAt: restored.savedAt });

    const endWorkbook = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_WORKBOOK");
    restoreInstalledWorkbook(restored.installedWorkbook);
    endWorkbook();
    const endOperator = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_OPERATOR");
    restoreCurrentCaseManager(restored.currentCaseManager);
    endOperator();
    const endExerciseIdentity = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_EXERCISE_IDENTITY");
    restoreExerciseIdentity(restored);
    restoreRuntimePatientCommandCursor(restored.exerciseSession.exerciseId, runtimeRestore.runtimePatientCommandCursor);
    endExerciseIdentity();
    const endAudits = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_AUDITS");
    restoreExerciseControlAudit(restored.exerciseControlAudit ?? []);
    restoreInstructorCommandAudit(restored.instructorCommandAudit ?? []);
    restoreExerciseResetAudit(restored.exerciseResetAudit ?? []);
    endAudits();
    endIdentity();
    const endPatients = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_PATIENTS", { patientCount: restored.patients.length });
    replaceItems(dataProvider.getPatients(), restored.patients);
    restoreAssignmentState(restored);
    restoreCaseManagerLocationState(restored.caseManagerZoneIds ?? {});
    endPatients();
    const endClinical = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_CLINICAL_COLLECTIONS");
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
    endClinical({ scenarioEventCount: restored.scenarioEvents.length });

    // Cold-start restoration prepares canonical owners but must not advance
    // time before remote current-exercise discovery and writer authority have
    // resolved. The authority startup rehydrates with startRuntime=true only
    // after that gate succeeds.
    const endRuntime = startRuntimeWorkTrace("STARTUP_LOCAL_RESTORE_RUNTIME");
    if (validatedLocal || !restored.runtimeCheckpoint) {
      await restoreCanonicalRuntimeAsync(runtimeRestore, false, yieldToEventLoop);
    } else {
      clearActiveClinicalReferenceRuntime();
      startRuntimeWorkTrace("STARTUP_LEGACY_CHECKPOINT_DEFERRED")({
        checkpointRevision: restored.runtimeCheckpoint.checkpointRevision,
      });
    }
    endRuntime({ persistedRuntimeCount: restored.persistedRuntimeStates?.length ?? 0 });
    setRuntimePersistenceFailure(undefined);
    endRestore();

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
    preparePatientTransportRuntime(session.exerciseId, restored.patientTransportRuntime);
    if (lifecycleState === "RUNNING" && startRuntime) startClockRunner();
  }
}

async function restoreCanonicalRuntimeAsync(restored: SharedExerciseState, startRuntime: boolean, yieldControl: PipelineYield): Promise<void> {
  const session = restored.exerciseSession;
  const lifecycleState = "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
  if (lifecycleState === "RUNNING" || lifecycleState === "PAUSED") {
    assertRuntimeCheckpointClockConsistency(restored);
    await prepareActiveClinicalReferenceRuntimeAsync(session.exerciseId, restored.persistedRuntimeStates ?? [], yieldControl);
    preparePatientTransportRuntime(session.exerciseId, restored.patientTransportRuntime);
    if (lifecycleState === "RUNNING" && startRuntime) startClockRunner();
  } else {
    clearActiveClinicalReferenceRuntime();
  }
}

export function startStatePersistence(): () => void {
  let stopped = false;
  let terminalCaptureGeneration: number | undefined;
  let terminalClockRetryScheduled = false;
  const obsoleteGate = new BoundedObsoleteGenerationGate();
  const pipeline = new LatestGenerationPipeline(async (generation, yieldControl) => {
    const yieldForGeneration = async (): Promise<void> => {
      await yieldControl();
      if (terminalCaptureGeneration !== undefined && generation < terminalCaptureGeneration) {
        throw new RuntimeCheckpointPreparationSupersededError();
      }
    };
    try {
      const completionPhase = getRuntimeCompletionPhase();
      if (terminalCaptureGeneration !== undefined
        && completionPhase.phase === "COMPLETED"
        && completionPhase.exerciseId === getRuntimeCompletionCheckpointIntent()?.exerciseId) {
        terminalCaptureGeneration = undefined;
        terminalClockRetryScheduled = false;
      }
      if (terminalCaptureGeneration !== undefined && generation >= terminalCaptureGeneration) {
        traceRuntimeLeaseLifecycle("COMPLETION_PREP_START", {
          detail: { generation, terminalCaptureGeneration },
        });
      }
      const shared = await collectSharedExerciseStateAsync(yieldForGeneration);
      if (stopped) return;
      await yieldControl();
      const persistedRuntimeCount = shared.persistedRuntimeStates?.length ?? 0;
      const preparationDecision = checkpointEnvelopePreparationDecision(
        persistedRuntimeCount,
        runtimeWritesAllowed(),
      );
      const endPreparation = startRuntimeWorkTrace("CHECKPOINT_ENVELOPE_PREPARATION", {
        generation,
        persistedRuntimeCount,
        eligibilityReason: preparationDecision.reason,
        exerciseId: shared.exerciseSession.exerciseId,
        lifecycleState: "lifecycleState" in shared.exerciseSession
          ? shared.exerciseSession.lifecycleState
          : shared.exerciseSession.state,
      });
      // A reader persists the exact validated authoritative checkpoint it
      // accepted. It must never mint a local revision from read-only state:
      // such a revision can outrank the next durable notification after a cold
      // restart even though it was never published by the sole writer.
      const preparedCheckpoint = preparationDecision.eligible
        ? await localRuntimeCheckpointStore.prepareCaptureAsync(shared, yieldForGeneration)
        : undefined;
      endPreparation({ prepared: Boolean(preparedCheckpoint), eligibilityReason: preparationDecision.reason });
      // Drop one obsolete preparation, but force the next one through CAS so a
      // continuously ticking Runtime cannot starve checkpoint publication.
      if (stopped || obsoleteGate.shouldDrop(pipeline.isCurrent(generation))) return;
      if (preparedCheckpoint && !localRuntimeCheckpointStore.commitPrepared(preparedCheckpoint)) {
        pipeline.request();
        return;
      }
      if (preparedCheckpoint && terminalCaptureGeneration !== undefined && generation >= terminalCaptureGeneration) {
        traceRuntimeLeaseLifecycle("COMPLETION_PAYLOAD_READY", {
          detail: { generation, checkpointRevision: preparedCheckpoint.checkpointRevision,
            simulationTimeSec: "simulationTimeSec" in shared.exerciseSession
              ? shared.exerciseSession.simulationTimeSec : shared.exerciseSession.currentMinute * 60 },
        });
      }
      // Remote discovery can request a save before authoritative Runtime
      // rehydration finishes. Keep the validated checkpoint for this exercise
      // instead of letting that transient projection erase the durable cache.
      const acceptedCheckpoint = preparedCheckpoint ?? localRuntimeCheckpointStore.get();
      const checkpointForSnapshot = acceptedCheckpoint?.exerciseId === shared.exerciseSession.exerciseId
        ? acceptedCheckpoint
        : undefined;
      // Commit and publication notification form one synchronous boundary so
      // a newer generation cannot make the committed checkpoint obsolete.
      const snapshot: PersistedState = {
        ...shared,
        version: STATE_VERSION,
        savedAt: new Date().toISOString(),
        currentCaseManager: { ...getCurrentCaseManager() },
        ...(checkpointForSnapshot
          ? getRuntimeCheckpointCanonicalRepresentation(checkpointForSnapshot)
            ? { runtimeCheckpointCanonical: getRuntimeCheckpointCanonicalRepresentation(checkpointForSnapshot) }
            : { runtimeCheckpoint: checkpointForSnapshot }
          : {}),
      };
      pendingSnapshot = snapshot;
      setLocalSaveStatus({ state: "saving", savedAt: localSaveStatus.savedAt });
      checkpointPreparedListeners.forEach(listener => listener());
      await yieldForGeneration();
      void flushLatestSnapshot();
    } catch (error) {
      if (error instanceof RuntimeCheckpointPreparationSupersededError) {
        startRuntimeWorkTrace("CHECKPOINT_PREPARATION_PREEMPTED")({ generation });
        return;
      }
      if (terminalCaptureGeneration !== undefined && error instanceof RuntimeCheckpointClockMismatchError) {
        const current = getCanonicalExerciseSnapshot();
        const canonicalClockSec = current.simulationTimeSec;
        const liveRuntimeClocks = getActiveClinicalReferenceRuntimeClocks(current.exerciseId);
        const decision = terminalClockReconciliationDecision({
          lifecycleState: current.lifecycleState,
          preparationClockSec: error.expectedSimulationTimeSec,
          canonicalClockSec,
          detachedRuntimeClocks: error.observedRuntimeClocks,
          liveRuntimeClocks,
          retryAlreadyScheduled: terminalClockRetryScheduled,
        });
        traceRuntimeLeaseLifecycle("COMPLETION_CLOCK_CHECK", { detail: {
          generation,
          preparationClockSec: decision.preparationClockSec,
          canonicalClockSec: decision.canonicalClockSec,
          deltaSec: decision.deltaSec,
          runtimeCount: liveRuntimeClocks.length,
          decision: decision.state,
        } });
        if (decision.state === "RETRY_FROM_CANONICAL_CLOCK") {
          terminalClockRetryScheduled = true;
          traceRuntimeLeaseLifecycle("COMPLETION_CLOCK_RECONCILED", { detail: {
            generation,
            canonicalClockSec: decision.canonicalClockSec,
            deltaSec: decision.deltaSec,
          } });
          terminalCaptureGeneration = pipeline.request();
          return;
        }
      }
      // A partially restored active Runtime must never be persisted. The
      // authority resolver may still replace it with a valid remote checkpoint.
      setLocalSaveStatus({ state: "error", savedAt: localSaveStatus.savedAt });
      console.warn("Exercise state snapshot was rejected.", error);
    }
  });
  const unsubscribe = subscribeToSync(() => pipeline.request());
  const stopCompletionIntent = installRuntimeCompletionIntentListener(active => {
    if (active) {
      const intent = getRuntimeCompletionCheckpointIntent();
      const completionPhase = getRuntimeCompletionPhase();
      if (intent
        && completionPhase.exerciseId === intent.exerciseId
        && completionPhase.phase === "COMPLETED") {
        terminalCaptureGeneration = undefined;
        terminalClockRetryScheduled = false;
        return;
      }
      terminalClockRetryScheduled = false;
      terminalCaptureGeneration = pipeline.request();
    } else {
      terminalCaptureGeneration = undefined;
      terminalClockRetryScheduled = false;
    }
  });
  return () => { stopped = true; unsubscribe(); stopCompletionIntent(); };
}

class RuntimeCheckpointPreparationSupersededError extends Error {
  constructor() { super("RUNTIME_CHECKPOINT_PREPARATION_SUPERSEDED"); }
}

async function flushLatestSnapshot(): Promise<void> {
  if (saveInFlight) return;
  saveInFlight = true;
  try {
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = undefined;
      const endSerialization = startRuntimeWorkTrace("LOCAL_SNAPSHOT_SERIALIZATION");
      const serialized = JSON.stringify(snapshot);
      endSerialization({ serializedBytes: serialized.length });
      const endWrite = startRuntimeWorkTrace("LOCAL_SNAPSHOT_WRITE", { serializedBytes: serialized.length });
      await FileSystem.writeAsStringAsync(stateTempFileUri, serialized);
      await FileSystem.moveAsync({ from: stateTempFileUri, to: stateFileUri });
      endWrite();
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
