import { setQuestionVisibility } from "@/repositories/QuestionRepository";
import { logQuestionRevealed } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";

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
}
