import type { CurrentExerciseCandidate } from "./CurrentExerciseSelectionService";
import { exerciseLifecycle } from "./CurrentExerciseSelectionService";
import { getConflictingRemoteExercises, publishExplicitlySelectedTerminalExercise, refreshRemoteCurrentExercise, selectConflictingRemoteExercise } from "@/services/CloudSyncService";
import { terminateExerciseWithMissingRuntime } from "@/services/ExerciseRuntimeRecoveryFoundationService";
import { startRuntimeCheckpointSync } from "@/services/RuntimeCheckpointSyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { supabase } from "@/services/SupabaseService";
import { recordSupabaseTraffic } from "@/services/SupabaseTrafficMetrics";

export type ActiveExerciseConflictDetail = Readonly<{ exerciseId:string; packageId?:string; lifecycle:string; updatedAt:string; simulationTimeSec?:number; version:number; checkpoint:"AVAILABLE"|"MISSING"|"UNKNOWN"; checkpointRevision?:number; lease:"ACTIVE"|"INACTIVE"|"UNKNOWN"; writerInstanceId?:string; recoveryEligible:boolean }>;
type CheckpointRow={exercise_id:string;checkpoint_revision:number;writer_instance_id:string};
type LeaseRow={exercise_id:string;writer_instance_id:string;expires_at:string;released_at:string|null};

export function detailFromCandidate(candidate:CurrentExerciseCandidate,checkpoint?:CheckpointRow,lease?:LeaseRow,metadataKnown=true):ActiveExerciseConflictDetail {
  const session=candidate.state.exerciseSession;
  const simulationTimeSec="simulationTimeSec" in session?session.simulationTimeSec:session.currentMinute*60;
  const version="version" in session?session.version:candidate.revision;
  const leaseActive=Boolean(lease&&!lease.released_at&&Date.parse(lease.expires_at)>Date.now());
  const persistedRuntime=candidate.state.persistedRuntimeStates?.some(value=>value.provenance.exerciseId===candidate.exerciseId)??false;
  return Object.freeze({exerciseId:candidate.exerciseId,...(candidate.state.exercisePackageReference?.packageId?{packageId:candidate.state.exercisePackageReference.packageId}:{}),lifecycle:exerciseLifecycle(candidate.state),updatedAt:candidate.updatedAt,simulationTimeSec,version,checkpoint:metadataKnown?(checkpoint?"AVAILABLE":"MISSING"):"UNKNOWN",...(checkpoint?{checkpointRevision:checkpoint.checkpoint_revision}:{}),lease:metadataKnown?(leaseActive?"ACTIVE":"INACTIVE"):"UNKNOWN",...(lease?.writer_instance_id?{writerInstanceId:lease.writer_instance_id}:{}),recoveryEligible:metadataKnown&&!checkpoint&&!leaseActive&&!persistedRuntime});
}

export async function loadActiveExerciseConflictDetails():Promise<readonly ActiveExerciseConflictDetail[]> {
  const candidates=getConflictingRemoteExercises();
  if(!supabase||candidates.length===0)return Object.freeze(candidates.map(candidate=>detailFromCandidate(candidate,undefined,undefined,false)));
  const ids=candidates.map(candidate=>candidate.exerciseId);
  const [{data:checkpointRows,error:checkpointError},{data:leaseRows,error:leaseError}]=await Promise.all([
    supabase.from("runtime_checkpoints").select("exercise_id,checkpoint_revision,writer_instance_id").in("exercise_id",ids),
    supabase.from("runtime_writer_leases").select("exercise_id,writer_instance_id,expires_at,released_at").in("exercise_id",ids),
  ]);
  recordSupabaseTraffic({operation:"SELECT",endpoint:"runtime_checkpoints.conflict_metadata",data:checkpointRows});
  recordSupabaseTraffic({operation:"SELECT",endpoint:"runtime_writer_leases.conflict_metadata",data:leaseRows});
  if(checkpointError||leaseError)return Object.freeze(candidates.map(candidate=>detailFromCandidate(candidate,undefined,undefined,false)));
  const checkpoints=new Map(((checkpointRows??[])as CheckpointRow[]).map(row=>[row.exercise_id,row]));
  const leases=new Map(((leaseRows??[])as LeaseRow[]).map(row=>[row.exercise_id,row]));
  return Object.freeze(candidates.map(candidate=>detailFromCandidate(candidate,checkpoints.get(candidate.exerciseId),leases.get(candidate.exerciseId))));
}

export async function continueSelectedActiveExercise(exerciseId:string):Promise<Readonly<{ok:boolean;code?:string}>> {
  if(!selectConflictingRemoteExercise(exerciseId))return Object.freeze({ok:false,code:"EXERCISE_NOT_IN_CURRENT_CONFLICT"});
  if(getCanonicalExerciseSnapshot().exerciseId!==exerciseId)return Object.freeze({ok:false,code:"SELECTED_EXERCISE_IDENTITY_MISMATCH"});
  try{
    await startRuntimeCheckpointSync();
    await publishExplicitlySelectedTerminalExercise();
    return Object.freeze({ok:true});
  }catch(error){return Object.freeze({ok:false,code:error instanceof Error?error.message:"AUTHORITY_START_FAILED"});}
}

export async function recoverSelectedBrokenExercise(exerciseId:string,expectedVersion:number){const result=await terminateExerciseWithMissingRuntime(exerciseId,expectedVersion);await refreshRemoteCurrentExercise();return result;}
export async function refreshActiveExerciseConflict(){await refreshRemoteCurrentExercise();return loadActiveExerciseConflictDetails();}
