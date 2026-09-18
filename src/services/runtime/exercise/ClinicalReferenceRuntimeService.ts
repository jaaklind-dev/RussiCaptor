import { getAllPatients } from "@/repositories/PatientRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE, CARDIAC_ARREST_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader, getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getPatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";
import type { PersistedRuntimeState, RuntimeProvenance } from "@/models/PersistedRuntimeState";
import { canonicalRuntimePersistenceService, moduleCompositionHash } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import { registerExerciseClockTarget } from "@/services/runtime/exercise/ExerciseClockTargetRegistry";
import { createScenarioEngineExerciseClockTarget } from "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";
import { clearPatientTransportRuntime, preparePatientTransportRuntime } from "./PatientTransportRuntimeService";
import type { LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";

let active: Readonly<{ exerciseId: string; patientId: string; engine: ClinicalScenarioEngine; dispose: () => void }>[] = [];

/** Validated Runtime owners may be read on a reader, while their write methods remain authority-gated. */
export function isClinicalReferenceRuntimeReadReady(exerciseId: string): boolean {
  return active.length > 0 && active.every(item => item.exerciseId === exerciseId);
}

export function assertActiveRuntimeExerciseIdentity(
  bindings: readonly Readonly<{ exerciseId: string }>[],
  expectedExerciseId: string,
): void {
  if (bindings.some(item => item.exerciseId !== expectedExerciseId)) {
    throw new Error("RUNTIME_CHECKPOINT_EXERCISE_MISMATCH");
  }
}

/** Connects the selected reference package to the existing authoritative runtime when the exercise starts. */
function provenance(exerciseId: string, patientId: string, pkg: NonNullable<ReturnType<typeof activeExercisePackageService.getActive>>): RuntimeProvenance {
  const modules = pkg.definition.clinicalModuleComposition?.modules ?? pkg.requiredClinicalModules ?? [];
  return {
    exerciseId, patientId, packageId: pkg.packageId, packageVersion: pkg.packageVersion,
    packageHash: pkg.packageHash, definitionHash: pkg.manifest.definitionHash,
    moduleCompositionHash: moduleCompositionHash(modules),
  };
}

export function prepareActiveClinicalReferenceRuntime(exerciseId: string, persisted: readonly PersistedRuntimeState[] = []): void {
  const endPreparation = startRuntimeWorkTrace("STARTUP_RUNTIME_ENGINE_PREPARE", { persistedRuntimeCount: persisted.length });
  const pkg = persisted.length ? getExercisePackage(exerciseId) : activeExercisePackageService.getActive();
  const materialized = getPatientMaterialization(exerciseId);
  const endTransport = startRuntimeWorkTrace("STARTUP_RUNTIME_TRANSPORT_RESTORE");
  preparePatientTransportRuntime(exerciseId);
  endTransport();
  const configured = materialized?.patients.filter(record => record.runtimeFixture) ?? [];
  const legacyReference = pkg?.packageId === CARDIAC_ARREST_EXERCISE_PACKAGE.packageId || pkg?.packageId === ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageId;
  const fallback = legacyReference ? getAllPatients().find(item => item.status === "Active" || item.status === "Incoming") : undefined;
  const records = configured.length ? configured : fallback ? [{ patient: fallback, runtimeFixture: { ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId: fallback.id } }] : [];
  if (!pkg || !records.length) { endPreparation({ outcome: "NO_RUNTIME_RECORDS" }); return; }
  if (!persisted.length && active.length && active.every(item => item.exerciseId === exerciseId) && active.length === records.length) { endPreparation({ outcome: "REUSED_ACTIVE" }); return; }
  exercisePackageLoader.bind(exerciseId, pkg);
  if (persisted.length && persisted.length !== records.length) throw new Error("RUNTIME_PERSISTENCE_PATIENT_SET_MISMATCH");
  const candidates: { exerciseId: string; patientId: string; engine: ClinicalScenarioEngine }[] = [];
  try { for (const [runtimeIndex, record] of records.entries()) {
    const patient = record.patient; const fixture = record.runtimeFixture!; const engine = new ClinicalScenarioEngine();
    const artifact = persisted.find(item => item.provenance.patientId === patient.id);
    if (persisted.length && !artifact) throw new Error(`RUNTIME_PERSISTENCE_PATIENT_MISSING:${patient.id}`);
    if (artifact) {
      const endEngineRehydrate = startRuntimeWorkTrace("STARTUP_RUNTIME_ENGINE_REHYDRATE", { runtimeIndex });
      canonicalRuntimePersistenceService.rehydrate(engine, artifact, provenance(exerciseId, patient.id, pkg));
      endEngineRehydrate();
    }
    else engine.reset(structuredClone(fixture));
    if (!artifact && fixture.initialState && typeof fixture.initialState === "object" && "cardiacArrest" in fixture.initialState) {
      addTimelineEvent({
    id: `TL-CARDIAC-ARREST-${exerciseId}-${patient.id}`,
    exerciseId,
    patientId: patient.id,
    timestamp: "T+0s",
    simulationTimeSec: 0,
    type: "status",
    title: "Cardiac arrest started",
    description: "Canonical cardiac state ARREST",
    author: "Scenario Runtime",
    visibility: "revealed",
      });
      addTimelineEvent({
    id: `TL-CARDIAC-RHYTHM-${exerciseId}-${patient.id}`,
    exerciseId,
    patientId: patient.id,
    timestamp: "T+0s",
    simulationTimeSec: 0,
    type: "status",
    title: "Cardiac rhythm observed",
    description: "PEA · NON_SHOCKABLE",
    author: "Scenario Runtime",
    visibility: "revealed",
      });
    }
    candidates.push({ exerciseId, patientId: patient.id, engine });
  } } catch (error) { throw error; }

  // A newer authoritative checkpoint is built and validated before the stale
  // local runtime is replaced. Runtime registrations are swapped synchronously,
  // so local and remote revisions are never live at the same time.
  active.forEach(item => item.dispose());
  active = candidates.map(({ patientId, engine }) => {
    const disposeOwner = registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const disposeClock = registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    return Object.freeze({
      exerciseId,
      patientId,
      engine,
      dispose: () => { disposeClock(); disposeOwner(); },
    });
  });
  endPreparation({ runtimeCount: candidates.length });
}

/** Production checkpoint startup keeps candidates private until cooperative rehydrate is complete. */
export async function prepareActiveClinicalReferenceRuntimeAsync(
  exerciseId: string,
  persisted: readonly PersistedRuntimeState[],
  yieldControl: PipelineYield,
): Promise<void> {
  if (!persisted.length) { prepareActiveClinicalReferenceRuntime(exerciseId, persisted); return; }
  const endPreparation = startRuntimeWorkTrace("STARTUP_RUNTIME_ENGINE_PREPARE_ASYNC", { persistedRuntimeCount: persisted.length });
  const pkg = getExercisePackage(exerciseId);
  const materialized = getPatientMaterialization(exerciseId);
  preparePatientTransportRuntime(exerciseId);
  const records = materialized?.patients.filter(record => record.runtimeFixture) ?? [];
  if (!pkg || !records.length) { endPreparation({ outcome: "NO_RUNTIME_RECORDS" }); return; }
  if (persisted.length !== records.length) throw new Error("RUNTIME_PERSISTENCE_PATIENT_SET_MISMATCH");
  exercisePackageLoader.bind(exerciseId, pkg);
  const candidates: { exerciseId: string; patientId: string; engine: ClinicalScenarioEngine }[] = [];
  // No stale Runtime owner remains executable while a new authoritative
  // generation is cooperatively reconstructed. Failure therefore stays closed.
  active.forEach(item => item.dispose());
  active = [];
  for (const [runtimeIndex, record] of records.entries()) {
    const patient = record.patient;
    const artifact = persisted.find(item => item.provenance.patientId === patient.id);
    if (!artifact) throw new Error(`RUNTIME_PERSISTENCE_PATIENT_MISSING:${patient.id}`);
    const engine = new ClinicalScenarioEngine();
    const endEngineRehydrate = startRuntimeWorkTrace("STARTUP_RUNTIME_ENGINE_REHYDRATE", { runtimeIndex });
    await canonicalRuntimePersistenceService.rehydrateAsync(engine, artifact, provenance(exerciseId, patient.id, pkg), yieldControl);
    endEngineRehydrate({ readiness: "READY" });
    candidates.push({ exerciseId, patientId: patient.id, engine });
    await yieldControl();
  }
  active = candidates.map(({ patientId, engine }) => {
    const disposeOwner = registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const disposeClock = registerExerciseClockTarget(createScenarioEngineExerciseClockTarget(engine, patientId));
    return Object.freeze({ exerciseId, patientId, engine,
      dispose: () => { disposeClock(); disposeOwner(); } });
  });
  endPreparation({ runtimeCount: candidates.length, readiness: "READY" });
}

export function clearActiveClinicalReferenceRuntime(): void { active.forEach(item => item.dispose()); active = []; clearPatientTransportRuntime(); }

/** Read-only canonical laboratory projection. Readers expose restored checkpoint state and never generate results here. */
export function getActiveLaboratoryWorkflow(
  exerciseId: string,
  patientId: string,
): LaboratoryWorkflowSnapshot | undefined {
  return active.find(item => item.exerciseId === exerciseId && item.patientId === patientId)
    ?.engine.getLaboratoryWorkflow();
}

/** Applies terminal semantics at the same authoritative Runtime boundary used for terminal checkpoint capture. */
export function fenceActiveLaboratoryWorkflowsAtTerminal(exerciseId: string, simulationTimeSec: number): void {
  assertActiveRuntimeExerciseIdentity(active, exerciseId);
  active.forEach(item => item.engine.fenceLaboratoryAtTerminal(simulationTimeSec));
}

export function captureActiveClinicalReferenceRuntimes(expectedSimulationTimeSec?: number, expectedExerciseId?: string): readonly PersistedRuntimeState[] {
  if (!active.length) return [];
  if (expectedExerciseId !== undefined) assertActiveRuntimeExerciseIdentity(active, expectedExerciseId);
  const captured = active.slice().sort((a, b) => a.patientId.localeCompare(b.patientId)).map(item =>
    canonicalRuntimePersistenceService.capture(item.engine, provenance(item.exerciseId, item.patientId, getExercisePackage(item.exerciseId)))
  );
  if (expectedSimulationTimeSec !== undefined && captured.some(item => item.capturedAtSimulationTimeSec !== expectedSimulationTimeSec)) {
    throw new Error("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
  }
  return captured;
}

export async function captureActiveClinicalReferenceRuntimesAsync(
  expectedSimulationTimeSec: number | undefined,
  yieldControl: PipelineYield,
  expectedExerciseId?: string,
): Promise<readonly PersistedRuntimeState[]> {
  if (!active.length) return [];
  if (expectedExerciseId !== undefined) assertActiveRuntimeExerciseIdentity(active, expectedExerciseId);
  // Detach every patient payload before yielding. This preserves one logical
  // clock boundary while expensive canonicalization proceeds cooperatively.
  const endDetach = startRuntimeWorkTrace("RUNTIME_PAYLOAD_DETACH", { runtimeCount: active.length });
  const detached: {
    payload: ReturnType<ClinicalScenarioEngine["captureRuntimePayload"]>;
    provenance: RuntimeProvenance;
  }[] = [];
  for (const [runtimeIndex, item] of active.slice().sort((a, b) => a.patientId.localeCompare(b.patientId)).entries()) {
    const endSnapshot = startRuntimeWorkTrace("PRE_CANON_RUNTIME_SNAPSHOT", { runtimeIndex });
    const payload = item.engine.captureRuntimePayload();
    endSnapshot({ simulationTimeSec: payload.simulationTimeSec });
    const endProvenance = startRuntimeWorkTrace("PRE_CANON_RUNTIME_PROVENANCE", { runtimeIndex });
    const runtimeProvenance = provenance(item.exerciseId, item.patientId, getExercisePackage(item.exerciseId));
    endProvenance();
    detached.push({ payload, provenance: runtimeProvenance });
  }
  endDetach({ runtimeCount: detached.length });
  if (expectedSimulationTimeSec !== undefined && detached.some(item => item.payload.simulationTimeSec !== expectedSimulationTimeSec)) {
    throw new Error("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
  }
  const captured: PersistedRuntimeState[] = [];
  for (const item of detached) {
    captured.push(await canonicalRuntimePersistenceService.capturePayloadAsync(
      item.payload,
      item.provenance,
      yieldControl,
    ));
    await yieldControl();
  }
  return captured;
}
