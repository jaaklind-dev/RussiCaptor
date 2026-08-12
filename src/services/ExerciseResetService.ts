import { resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { resetImagingStudies } from "@/repositories/ImagingRepository";
import { resetLabResults } from "@/repositories/LabRepository";
import { resetOrders } from "@/repositories/OrderRepository";
import { resetQuestions } from "@/repositories/QuestionRepository";
import { clearScenarioEvents } from "@/repositories/ScenarioRepository";
import { clearTimelineEvents } from "@/repositories/TimelineRepository";
import { resetPatients } from "@/repositories/PatientRepository";
import { resetNotes } from "@/repositories/NoteRepository";
import { resetInterventions } from "@/repositories/InterventionRepository";
import { resetMedicationAdministrations } from "@/repositories/MedicationRepository";
import { resetVitalSigns } from "@/repositories/VitalSignsRepository";
import { resetCaseManagerLocations } from "@/services/CurrentLocationService";
import { clearAssignments } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { notifySync } from "@/services/SyncService";
import { resetCurrentCaseManager } from "@/services/CurrentUserService";
import { clearRuntimeSnapshots } from "@/services/RuntimeSnapshotService";
import { clearInstructorRuntimeOwners } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { resetResourceInterventionCommands } from "@/services/runtime/instructor/ResourceInterventionCommandService";
import { clearActiveClinicalReferenceRuntime } from "@/services/runtime/exercise/ClinicalReferenceRuntimeService";
import { resetExerciseControlCommandHandler } from "@/services/runtime/exercise/ExerciseControlCommandHandler";
import { resetInstructorCommandHandler } from "@/features/instructor/commands/InstructorPatientCommandHandler";
import { restorePatientMaterialization } from "@/services/exercise/PackagePatientMaterializationService";

/** @deprecated Test/reset compatibility helper. Production exercise preparation uses runtime/exercise/ExerciseResetService. */
export function resetExercise(): void {
  stopClockRunner();
  resetExerciseSession();
  resetImagingStudies();
  resetLabResults();
  resetOrders();
  resetQuestions();
  resetNotes();
  resetInterventions();
  resetMedicationAdministrations();
  resetVitalSigns();
  clearScenarioEvents();
  clearTimelineEvents();
  resetPatients();
  clearAssignments();
  resetCurrentCaseManager();
  resetCaseManagerLocations();
  notifySync();
}

/** Clears mutable per-exercise working data after canonical preparation archived the completed exercise. */
export function clearPreparedExerciseWorkingData(): void {
  stopClockRunner();
  resetImagingStudies(); resetLabResults(); resetOrders(); resetQuestions(); resetNotes();
  resetInterventions(); resetMedicationAdministrations(); resetVitalSigns(); clearScenarioEvents(); clearTimelineEvents();
  resetPatients(); clearAssignments(); resetCurrentCaseManager(); resetCaseManagerLocations(); clearRuntimeSnapshots();
  clearInstructorRuntimeOwners(); clearActiveClinicalReferenceRuntime(); resetExerciseControlCommandHandler(); resetInstructorCommandHandler(); resetResourceInterventionCommands();
  restorePatientMaterialization();
}
