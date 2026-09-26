import type { Visibility } from "@/models/Visibility";

export type PackageQuestionDefinition = Readonly<{
  questionId: string;
  patientId: string;
  sourcePatientId: string;
  category: string;
  order: number;
  prompt: string;
  answer: string;
  visibility: Visibility;
}>;

export type PackageQuestionConfiguration = Readonly<{
  schemaVersion: 1;
  definitions: readonly PackageQuestionDefinition[];
}>;
