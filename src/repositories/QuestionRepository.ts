import { Question } from "@/models/Question";
import { questions } from "@/data/questions";

export function getQuestions(patientId: string): Question[] {
  return questions
    .filter((question) => question.patientId === patientId)
    .sort((a, b) => a.order - b.order);
}

export function revealQuestion(
  patientId: string,
  questionId: string
): Question[] {
  return questions.map((question) =>
    question.patientId === patientId &&
    question.id === questionId
      ? { ...question, visibility: "revealed" }
      : question
  );
}