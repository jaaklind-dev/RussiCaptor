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
import { clearPatientTransportRuntime, preparePatientTransportRuntime } from "./PatientTransportRuntimeService";

let active: Readonly<{ exerciseId: string; patientId: string; engine: ClinicalScenarioEngine; dispose: () => void }>[] = [];

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
  const pkg = persisted.length ? getExercisePackage(exerciseId) : activeExercisePackageService.getActive();
  const materialized = getPatientMaterialization(exerciseId);
  preparePatientTransportRuntime(exerciseId);
  const configured = materialized?.patients.filter(record => record.runtimeFixture) ?? [];
  const legacyReference = pkg?.packageId === CARDIAC_ARREST_EXERCISE_PACKAGE.packageId || pkg?.packageId === ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageId;
  const fallback = legacyReference ? getAllPatients().find(item => item.status === "Active" || item.status === "Incoming") : undefined;
  const records = configured.length ? configured : fallback ? [{ patient: fallback, runtimeFixture: { ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId: fallback.id } }] : [];
  if (!pkg || !records.length) return;
  if (!persisted.length && active.length && active.every(item => item.exerciseId === exerciseId) && active.length === records.length) return;
  exercisePackageLoader.bind(exerciseId, pkg);
  if (persisted.length && persisted.length !== records.length) throw new Error("RUNTIME_PERSISTENCE_PATIENT_SET_MISMATCH");
  const candidates: { exerciseId: string; patientId: string; engine: ClinicalScenarioEngine }[] = [];
  try { for (const record of records) {
    const patient = record.patient; const fixture = record.runtimeFixture!; const engine = new ClinicalScenarioEngine();
    const artifact = persisted.find(item => item.provenance.patientId === patient.id);
    if (persisted.length && !artifact) throw new Error(`RUNTIME_PERSISTENCE_PATIENT_MISSING:${patient.id}`);
    if (artifact) canonicalRuntimePersistenceService.rehydrate(engine, artifact, provenance(exerciseId, patient.id, pkg));
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
}

export function clearActiveClinicalReferenceRuntime(): void { active.forEach(item => item.dispose()); active = []; clearPatientTransportRuntime(); }

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
  const detached = active.slice().sort((a, b) => a.patientId.localeCompare(b.patientId)).map(item => ({
    payload: item.engine.captureRuntimePayload(),
    provenance: provenance(item.exerciseId, item.patientId, getExercisePackage(item.exerciseId)),
  }));
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
