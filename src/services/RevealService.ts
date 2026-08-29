import { setQuestionVisibility } from "@/repositories/QuestionRepository";
import { logQuestionRevealed } from "@/repositories/TimelineRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";

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

export function revealQuestionConflictSafe(patientId:string,questionId:string){
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-QUESTION"),kind:"MUTABLE",mutate:()=>revealQuestion(patientId,questionId)});
}
