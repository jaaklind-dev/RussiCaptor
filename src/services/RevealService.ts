import { QuestionItem } from "@/models/Patient";
import { logQuestionRevealed } from "@/repositories/TimelineRepository";

export function revealQuestion(
  questions: QuestionItem[],
  patientId: string,
  questionId: string
): QuestionItem[] {

  logQuestionRevealed(patientId, questionId);

  return questions.map((question) =>
    question.id === questionId
      ? { ...question, visibility: "revealed" }
      : question
  );
}