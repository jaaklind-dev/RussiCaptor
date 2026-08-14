import type { PrincipalState, RoleAssignment } from "@/models/authorization/Authorization";
import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import { AuthorizationService } from "@/services/authorization/AuthorizationService";
import { resolvePrincipalPermissions } from "@/services/authorization/PermissionResolver";
import { ExerciseRuntimeRecoveryService, type ExerciseRuntimeRecoveryCommand, type ExerciseRuntimeRecoveryErrorCode, type ExerciseRuntimeRecoveryRepository } from "../ExerciseRuntimeRecoveryService";

const assignment = (scope: RoleAssignment["scope"]): RoleAssignment => ({ assignmentId:"A-1",userId:"U-1",role:"EXCON",scope,status:"ACTIVE",issuedAt:"2026-08-14T00:00:00Z",issuedBy:"ADMIN" });
const principal = (scope?: RoleAssignment["scope"]): PrincipalState => {
  const assignments = scope ? [assignment(scope)] : [];
  return { state:"AUTHENTICATED",principal:{userId:"U-1",authenticationState:"AUTHENTICATED",roleAssignments:assignments,permissions:resolvePrincipalPermissions(assignments),authorizationFreshness:"VERIFIED_ONLINE",authorizationProvenance:{authority:"SUPABASE_ROLE_ASSIGNMENTS",verifiedAt:"2026-08-14T01:00:00Z",expiresAt:"2026-08-14T01:05:00Z"}}};
};
class FakeRepository implements ExerciseRuntimeRecoveryRepository {
  lifecycle: CanonicalExerciseSnapshot["lifecycleState"]="RUNNING"; checkpoint=false; writer=false; version=1; checkpointsCreated=0;
  timeline=["EXERCISE_STARTED","PATIENT_EVENT"];
  async terminate(command:ExerciseRuntimeRecoveryCommand): ReturnType<ExerciseRuntimeRecoveryRepository["terminate"]> {
    if(this.lifecycle!=="RUNNING"&&this.lifecycle!=="PAUSED")return {code:"INVALID_EXERCISE_LIFECYCLE" as const};
    if(command.expectedVersion!==this.version)return {code:"RECOVERY_NOT_REQUIRED" as const};
    if(this.checkpoint)return {code:"RUNTIME_CHECKPOINT_AVAILABLE" as const};
    if(this.writer)return {code:"ACTIVE_RUNTIME_WRITER_PRESENT" as const};
    this.lifecycle="COMPLETED";this.version+=1;
    return {snapshot:{exerciseId:command.exerciseId,lifecycleState:this.lifecycle,simulationTimeSec:10,speed:1 as const,version:this.version},auditId:"AUDIT-1"};
  }
}
const authorizer = () => { const auth=new AuthorizationService({append:async()=>undefined}); return async(state:PrincipalState,exerciseId:string)=>(await auth.authorize(state,"EXERCISE_RUNTIME_RECOVERY",{exerciseId})).status==="AUTHORIZED"; };
const command=(exerciseId="EX-1"):ExerciseRuntimeRecoveryCommand=>({exerciseId,expectedVersion:1,persistenceFailure:"ACTIVE_RUNTIME_PERSISTENCE_MISSING"});

describe("WP-44B missing Runtime administrative recovery",()=>{
  test("GLOBAL EXCON recovers eligible RUNNING exercise without a fabricated checkpoint",async()=>{const repo=new FakeRepository();const result=await new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command());expect(result).toMatchObject({ok:true,snapshot:{lifecycleState:"COMPLETED"}});expect(repo.checkpointsCreated).toBe(0);});
  test("EXERCISE-scoped EXCON recovers only its assigned exercise",async()=>{const service=new ExerciseRuntimeRecoveryService(new FakeRepository(),authorizer());await expect(service.terminate(principal({scopeType:"EXERCISE",scopeId:"EX-1"}),command("EX-1"))).resolves.toMatchObject({ok:true});await expect(service.terminate(principal({scopeType:"EXERCISE",scopeId:"EX-1"}),command("EX-2"))).resolves.toMatchObject({ok:false,code:"RECOVERY_NOT_AUTHORIZED"});});
  test("non-EXCON and UI mode alone are denied",async()=>{const forged={...principal(),uiMode:"EXCON"} as unknown as PrincipalState;await expect(new ExerciseRuntimeRecoveryService(new FakeRepository(),authorizer()).terminate(forged,command())).resolves.toMatchObject({ok:false,code:"RECOVERY_NOT_AUTHORIZED"});});
  test.each([["checkpoint","RUNTIME_CHECKPOINT_AVAILABLE"],["writer","ACTIVE_RUNTIME_WRITER_PRESENT"]] as const)("%s appearing before execution blocks recovery",async(field,code)=>{const repo=new FakeRepository();repo[field]=true;await expect(new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command())).resolves.toMatchObject({ok:false,code});});
  test("PAUSED missing Runtime may be recovery-terminated",async()=>{const repo=new FakeRepository();repo.lifecycle="PAUSED";await expect(new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command())).resolves.toMatchObject({ok:true,snapshot:{lifecycleState:"COMPLETED"}});});
  test("terminal exercise is not applicable",async()=>{const repo=new FakeRepository();repo.lifecycle="COMPLETED";await expect(new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command())).resolves.toMatchObject({ok:false,code:"INVALID_EXERCISE_LIFECYCLE"});});
  test("race to a valid writer is rechecked by repository at execution",async()=>{const repo=new FakeRepository();const service=new ExerciseRuntimeRecoveryService(repo,authorizer());repo.writer=true;await expect(service.terminate(principal({scopeType:"GLOBAL"}),command())).resolves.toMatchObject({ok:false,code:"ACTIVE_RUNTIME_WRITER_PRESENT"});});
  test("successful recovery unblocks completed-only preparation policy",async()=>{const repo=new FakeRepository();const result=await new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command());expect(result.ok&&result.snapshot.lifecycleState==="COMPLETED").toBe(true);});
  test("historical Timeline evidence is preserved and no clinical recovery evidence is added",async()=>{const repo=new FakeRepository();const before=[...repo.timeline];await new ExerciseRuntimeRecoveryService(repo,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command());expect(repo.timeline).toEqual(before);});
  test("backend failure is typed",async()=>{const failing:ExerciseRuntimeRecoveryRepository={terminate:async()=>{throw new Error("offline")}};await expect(new ExerciseRuntimeRecoveryService(failing,authorizer()).terminate(principal({scopeType:"GLOBAL"}),command())).resolves.toMatchObject({ok:false,code:"RECOVERY_BACKEND_FAILED" satisfies ExerciseRuntimeRecoveryErrorCode});});
});
