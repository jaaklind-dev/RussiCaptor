import { setQuestionVisibility } from "@/repositories/QuestionRepository";
import { logQuestionRevealed } from "@/repositories/TimelineRepository";

export function revealQuestion(
  patientId: string,
  questionId: string
): void {
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