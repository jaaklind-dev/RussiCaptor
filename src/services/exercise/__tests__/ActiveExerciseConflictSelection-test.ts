let mockCanonicalExerciseId="STALE-LOCAL";
const mockSelectExercise=jest.fn((exerciseId:string)=>{mockCanonicalExerciseId=exerciseId;return true;});
const mockStartRuntime=jest.fn(async()=>()=>{});
const mockPublishTerminal=jest.fn(async()=>false);
jest.mock("@/services/CloudSyncService",()=>({getConflictingRemoteExercises:()=>[],publishExplicitlySelectedTerminalExercise:()=>mockPublishTerminal(),refreshRemoteCurrentExercise:jest.fn(),selectConflictingRemoteExercise:(id:string)=>mockSelectExercise(id)}));
jest.mock("@/services/ExerciseRuntimeRecoveryFoundationService",()=>({terminateExerciseWithMissingRuntime:jest.fn()}));
jest.mock("@/services/RuntimeCheckpointSyncService",()=>({startRuntimeCheckpointSync:()=>mockStartRuntime()}));
jest.mock("@/repositories/ExerciseSessionRepository",()=>({getCanonicalExerciseSnapshot:()=>({exerciseId:mockCanonicalExerciseId})}));
jest.mock("@/services/SupabaseService",()=>({supabase:undefined}));

// eslint-disable-next-line import/first
import { continueSelectedActiveExercise } from "../ActiveExerciseConflictResolutionService";

describe("explicit active exercise conflict selection",()=>{
  beforeEach(()=>{mockCanonicalExerciseId="STALE-LOCAL";mockSelectExercise.mockClear();mockStartRuntime.mockClear();mockPublishTerminal.mockClear();});
  test("does not acquire writer before explicit selection",()=>expect(mockStartRuntime).not.toHaveBeenCalled());
  test("only the explicitly selected exercise reaches Runtime authority startup and terminal reconciliation",async()=>{await expect(continueSelectedActiveExercise("REMOTE-B")).resolves.toEqual({ok:true});expect(mockSelectExercise).toHaveBeenCalledWith("REMOTE-B");expect(mockStartRuntime).toHaveBeenCalledTimes(1);expect(mockPublishTerminal).toHaveBeenCalledTimes(1);expect(mockCanonicalExerciseId).toBe("REMOTE-B");});
  test("failed selection never starts Runtime",async()=>{mockSelectExercise.mockImplementationOnce(()=>false);await expect(continueSelectedActiveExercise("NOT-LISTED")).resolves.toEqual({ok:false,code:"EXERCISE_NOT_IN_CURRENT_CONFLICT"});expect(mockStartRuntime).not.toHaveBeenCalled();});
});
