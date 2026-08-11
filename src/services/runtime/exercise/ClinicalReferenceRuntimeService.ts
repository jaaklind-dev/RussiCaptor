import { getAllPatients } from "@/repositories/PatientRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE, CARDIAC_ARREST_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { addTimelineEvent } from "@/repositories/TimelineRepository";

let active: Readonly<{ exerciseId: string; patientId: string; engine: ClinicalScenarioEngine; dispose: () => void }> | undefined;

/** Connects the selected reference package to the existing authoritative runtime when the exercise starts. */
export function prepareActiveClinicalReferenceRuntime(exerciseId: string): void {
  const pkg = activeExercisePackageService.getActive();
  if (pkg?.packageId !== CARDIAC_ARREST_EXERCISE_PACKAGE.packageId && pkg?.packageId !== ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.packageId) return;
  const patient = getAllPatients().find(item => item.status === "Active" || item.status === "Incoming");
  if (!patient) return;
  if (active?.exerciseId === exerciseId && active.patientId === patient.id) return;
  active?.dispose();
  exercisePackageLoader.bind(exerciseId, pkg);
  const engine = new ClinicalScenarioEngine();
  engine.reset({ ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId: patient.id });
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
  const dispose = registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patient.id));
  active = Object.freeze({ exerciseId, patientId: patient.id, engine, dispose });
}

export function clearActiveClinicalReferenceRuntime(): void { active?.dispose(); active = undefined; }
