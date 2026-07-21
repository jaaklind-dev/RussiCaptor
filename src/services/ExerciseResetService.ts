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
import { clearAssignments } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { notifySync } from "@/services/SyncService";
import { resetCurrentCaseManager } from "@/services/CurrentUserService";

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
  clearScenarioEvents();
  clearTimelineEvents();
  resetPatients();
  clearAssignments();
  resetCurrentCaseManager();
  notifySync();
}
