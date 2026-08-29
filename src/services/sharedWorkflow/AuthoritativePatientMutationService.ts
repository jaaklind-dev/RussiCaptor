import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync, runWithoutSyncNotifications } from "@/services/SyncService";
import { capturePatientSharedWorkflowState, restorePatientSharedWorkflowState } from "./PatientSharedWorkflowState";
import { getSharedWorkflowHead, sharedWorkflowStatusMessage, submitSharedWorkflowMutation,
  type SharedWorkflowMutationKind, type SharedWorkflowMutationResult } from "./SharedWorkflowMutationService";

export type AuthoritativeMutationOutcome<T> = Readonly<{ result: SharedWorkflowMutationResult; value?: T; message: string }>;

/**
 * Executes legacy repository mutation code only to build a proposal, rolls it
 * back before I/O, and exposes it locally only after the server transaction
 * accepts it. Offline and stale mutations therefore never look committed.
 */
export async function executeAuthoritativePatientMutation<T>(input:Readonly<{
  patientId:string; commandId:string; kind:SharedWorkflowMutationKind; expectedOwnerUserId?:string; expectUnowned?:boolean;
  nextOwnerUserId?:string; mutate:()=>T;
}>):Promise<AuthoritativeMutationOutcome<T>>{
  const exerciseId=getCanonicalExerciseSnapshot().exerciseId;const before=capturePatientSharedWorkflowState(input.patientId);
  const head=getSharedWorkflowHead(exerciseId,input.patientId);const operator=getCurrentCaseManager();
  const expectedOwnerUserId=head.revision>0?head.ownerUserId:input.expectUnowned?undefined:input.expectedOwnerUserId??operator.id;
  let value:T;let proposed:ReturnType<typeof capturePatientSharedWorkflowState>;
  try{value=runWithoutSyncNotifications(input.mutate);proposed=capturePatientSharedWorkflowState(input.patientId);}
  finally{restorePatientSharedWorkflowState(input.patientId,before);}
  const result=await submitSharedWorkflowMutation({exerciseId,patientId:input.patientId,commandId:input.commandId,kind:input.kind,
    expectedRevision:head.revision,expectedOwnerUserId,nextOwnerUserId:input.nextOwnerUserId??expectedOwnerUserId,state:proposed});
  if(result.state){restorePatientSharedWorkflowState(input.patientId,result.state as ReturnType<typeof capturePatientSharedWorkflowState>);notifySync(result.status==="APPLIED"||result.status==="IDEMPOTENT"?"device":"remote");}
  return Object.freeze({result,value:result.status==="APPLIED"||result.status==="IDEMPOTENT"?value:undefined,
    message:sharedWorkflowStatusMessage(result.status)+(operator.id===result.ownerUserId?"":"")});
}
