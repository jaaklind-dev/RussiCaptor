import { resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { resetImagingStudies } from "@/repositories/ImagingRepository";
import { resetLabResults } from "@/repositories/LabRepository";
import { resetOrders } from "@/repositories/OrderRepository";
import { resetQuestions } from "@/repositories/QuestionRepository";
import { clearScenarioEvents } from "@/repositories/ScenarioRepository";
import { clearTimelineEvents } from "@/repositories/TimelineRepository";
import { clearAssignments } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { notifySync } from "@/services/SyncService";

export function resetExercise(): void {
  stopClockRunner();
  resetExerciseSession();
  resetImagingStudies();
  resetLabResults();
  resetOrders();
  resetQuestions();
  clearScenarioEvents();
  clearTimelineEvents();
  clearAssignments();
  notifySync();
}
