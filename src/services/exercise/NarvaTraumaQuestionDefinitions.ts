import type { PackageQuestionConfiguration } from "@/models/exercise/PackageQuestionConfiguration";

/** Historical workbook rows retained by immutable Narva packages through 1.0.4. */
export const NARVA_TRAUMA_QUESTION_CONFIGURATION_V104: PackageQuestionConfiguration = Object.freeze({
  schemaVersion: 1,
  definitions: Object.freeze([
    Object.freeze({ questionId: "P01-Q1", patientId: "PT-PELVIC-001", sourcePatientId: "P01",
      category: "Trauma", order: 1, prompt: "Milline sekkumine vähendab vaagnaverejooksu?",
      answer: "Paigaldada vaagnalahas võimalikult vara ja korrektselt.", visibility: "hidden" as const }),
    Object.freeze({ questionId: "P01-Q2", patientId: "PT-PELVIC-001", sourcePatientId: "P01",
      category: "Transport", order: 2, prompt: "Miks võib patsient oodata reanimobiili tagasitulekut?",
      answer: "Vaagnalahas ja MTP loovad ajutise stabiliseerumisakna; lõplik ravi jääb siiski vältimatuks.",
      visibility: "hidden" as const }),
    Object.freeze({ questionId: "P02-Q1", patientId: "PT-CHEST-001", sourcePatientId: "P02",
      category: "Dreen", order: 1, prompt: "Kui suur oli esmane dreenieritus?",
      answer: "Ligikaudu 1450 ml verd.", visibility: "hidden" as const }),
    Object.freeze({ questionId: "P02-Q2", patientId: "PT-CHEST-001", sourcePatientId: "P02",
      category: "Dreen", order: 2, prompt: "Kui suur on jätkuv dreeniverejooks?",
      answer: "Ligikaudu 400 ml tunnis.", visibility: "hidden" as const }),
    Object.freeze({ questionId: "P02-Q3", patientId: "PT-CHEST-001", sourcePatientId: "P02",
      category: "Transport", order: 3, prompt: "Kus mängitakse transpordifaas läbi?",
      answer: "Seisvas reanimobiilis; auto reaalselt ei sõida.", visibility: "hidden" as const }),
    Object.freeze({ questionId: "P02-Q4", patientId: "PT-CHEST-001", sourcePatientId: "P02",
      category: "Transport", order: 4, prompt: "Miks transporditakse rindkerepatsient esimesena?",
      answer: "Tal on jätkuv aktiivne verejooks ja torakaalkeskus asub 30 minuti kaugusel.",
      visibility: "hidden" as const }),
  ]),
});

/** Current questions: P02-Q2 follows the explicit 200 ml/h authority that supersedes the workbook answer. */
export const NARVA_TRAUMA_QUESTION_CONFIGURATION: PackageQuestionConfiguration = Object.freeze({
  schemaVersion: 1,
  definitions: Object.freeze(NARVA_TRAUMA_QUESTION_CONFIGURATION_V104.definitions.map(question =>
    question.questionId === "P02-Q2"
      ? Object.freeze({ ...question, answer: "200 ml tunnis." })
      : question)),
});
