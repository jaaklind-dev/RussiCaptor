import { getAllPatients } from "@/repositories/PatientRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { CARDIAC_ARREST_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";

let active: Readonly<{ exerciseId: string; patientId: string; engine: ClinicalScenarioEngine; dispose: () => void }> | undefined;

/** Connects the selected reference package to the existing authoritative runtime when the exercise starts. */
export function prepareActiveClinicalReferenceRuntime(exerciseId: string): void {
  const pkg = activeExercisePackageService.getActive();
  if (pkg?.packageId !== CARDIAC_ARREST_EXERCISE_PACKAGE.packageId) return;
  const patient = getAllPatients().find(item => item.status === "Active" || item.status === "Incoming");
  if (!patient) return;
  if (active?.exerciseId === exerciseId && active.patientId === patient.id) return;
  active?.dispose();
  exercisePackageLoader.bind(exerciseId, pkg);
  const engine = new ClinicalScenarioEngine();
  engine.reset({ ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId: patient.id });
  const dispose = registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patient.id));
  active = Object.freeze({ exerciseId, patientId: patient.id, engine, dispose });
}

export function clearActiveClinicalReferenceRuntime(): void { active?.dispose(); active = undefined; }
