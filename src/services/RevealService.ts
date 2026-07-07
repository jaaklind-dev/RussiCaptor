import { QuestionItem } from "@/models/Patient";

export function revealQuestion(

  questions: QuestionItem[],

  questionId: string

): QuestionItem[] {

  return questions.map((question) =>

    question.id === questionId

      ? { ...question, visibility: "revealed" }

      : question

  );

}