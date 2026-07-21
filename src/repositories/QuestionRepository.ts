import { Question } from "@/models/Question";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getQuestions(patientId: string): Question[] {
  return clinicalDataProvider.getQuestions()
    .filter((question) => question.patientId === patientId)
    .sort((a, b) => a.order - b.order);
}

export function getQuestion(
  patientId: string,
  questionId: string
): Question | undefined {
  return clinicalDataProvider.getQuestions().find(
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
  const question = clinicalDataProvider.getQuestions().find(
    (question) =>
      question.patientId === patientId &&
      question.id === questionId
  );

  if (question) {
    question.visibility = visibility;
  }
}

export function resetQuestions(): void {
  clinicalDataProvider.resetQuestions();
}
