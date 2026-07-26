import { setQuestionVisibility } from "@/repositories/QuestionRepository";
import { logQuestionRevealed } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { notifySync } from "@/services/SyncService";

export function revealQuestion(
  patientId: string,
  questionId: string
): void {
  if (!canCurrentCaseManagerEditPatient(patientId)) {
    return;
  }

  setQuestionVisibility(
    patientId,
    questionId,
    "revealed"
  );

  logQuestionRevealed(
    patientId,
    questionId
  );

  notifySync();
}
