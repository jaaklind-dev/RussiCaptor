import { Question } from "@/models/Question";
import { questions } from "@/data/questions";

const initialQuestions = questions.map((question) => ({ ...question }));

export function getQuestions(patientId: string): Question[] {
  return questions
    .filter((question) => question.patientId === patientId)
    .sort((a, b) => a.order - b.order);
}

export function getQuestion(
  patientId: string,
  questionId: string
): Question | undefined {
  return questions.find(
    (question) =>
      question.patientId === patientId &&
      question.id === questionId
  );
}

export function setQuestionVisibility(
  patientId: string,
  questionId: string,
  visibility: Question["visibility"]
): void {
  const question = questions.find(
    (question) =>
      question.patientId === patientId &&
      question.id === questionId
  );

  if (question) {
    question.visibility = visibility;
  }
}

export function resetQuestions(): void {
  questions.splice(
    0,
    questions.length,
    ...initialQuestions.map((question) => ({ ...question }))
  );
}
