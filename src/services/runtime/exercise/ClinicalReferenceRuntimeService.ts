import { getAllPatients } from "@/repositories/PatientRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE, CARDIAC_ARREST_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getPatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";

let active: Readonly<{ exerciseId: string; patientId: string; engine: ClinicalScenarioEngine; dispose: () => void }>[] = [];

/** Connects the selected reference package to the existing authoritative runtime when the exercise starts. */
export function prepareActiveClinicalReferenceRuntime(exerciseId: string): void {
  const pkg = activeExercisePackageService.getActive();
  const materialized = getPatientMaterialization(exerciseId);
  const configured = materialized?.patients.filter(record => record.runtimeFixture) ?? [];
  const legacyReference = pkg?.packageId === CARDIAC_ARREST_EXERCISE_PACKAGE.packageId || pkg?.packageId === ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageId;
  const fallback = legacyReference ? getAllPatients().find(item => item.status === "Active" || item.status === "Incoming") : undefined;
  const records = configured.length ? configured : fallback ? [{ patient: fallback, runtimeFixture: { ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId: fallback.id } }] : [];
  if (!pkg || !records.length) return;
  if (active.length && active.every(item => item.exerciseId === exerciseId) && active.length === records.length) return;
  active.forEach(item => item.dispose()); active = [];
  exercisePackageLoader.bind(exerciseId, pkg);
  for (const record of records) {
    const patient = record.patient; const fixture = record.runtimeFixture!; const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
    if (fixture.initialState && typeof fixture.initialState === "object" && "cardiacArrest" in fixture.initialState) {
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
    const dispose = registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patient.id));
    active.push(Object.freeze({ exerciseId, patientId: patient.id, engine, dispose }));
  }
}

export function clearActiveClinicalReferenceRuntime(): void { active.forEach(item => item.dispose()); active = []; }
