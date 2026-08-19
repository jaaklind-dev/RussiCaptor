import type { SharedExerciseState } from "@/models/SharedExerciseState";
import fs from "fs";
import path from "path";
import { detailFromCandidate } from "../ActiveExerciseConflictResolutionService";
import { resolveCurrentExercise } from "../CurrentExerciseSelectionService";

const state=(exerciseId:string,lifecycleState:"READY"|"RUNNING"|"PAUSED"|"COMPLETED",persisted=false):SharedExerciseState=>({
  exerciseSession:{exerciseId,lifecycleState,simulationTimeSec:12,speed:1,version:4,clockVersion:2,clockInitializedAtSimulationTimeSec:0},
  patients:[],assignments:[],transfers:[],questions:[],labs:[],imagingStudies:[],orders:[],notes:[],scenarioEvents:[],timelineEvents:[],
  ...(persisted?{persistedRuntimeStates:[{provenance:{exerciseId}}] as unknown as NonNullable<SharedExerciseState["persistedRuntimeStates"]>}:{})
});
const candidate=(id:string,lifecycle:"READY"|"RUNNING"|"PAUSED"|"COMPLETED",updatedAt:string,persisted=false)=>({exerciseId:id,revision:1,state:state(id,lifecycle,persisted),updatedAt});

describe("active exercise conflict resolution contract",()=>{
  test("zero active exercises has no conflict",()=>expect(resolveCurrentExercise([candidate("DONE","COMPLETED","2026-01-01")]).status).toBe("SELECTED"));
  test("one active exercise uses normal deterministic startup selection",()=>expect(resolveCurrentExercise([candidate("EX-1","RUNNING","2026-01-01")])).toMatchObject({status:"SELECTED",candidate:{exerciseId:"EX-1"}}));
  test("two active exercises expose every authoritative candidate",()=>expect(resolveCurrentExercise([candidate("EX-1","RUNNING","2026-01-01"),candidate("EX-2","PAUSED","2026-01-02")])).toMatchObject({status:"CONFLICT",exerciseIds:["EX-2","EX-1"],candidates:[{exerciseId:"EX-2"},{exerciseId:"EX-1"}]}));
  test("detail reports checkpoint, writer and recovery eligibility without changing canonical identity",()=>{const input=candidate("EX-1","RUNNING","2026-01-01");const before=JSON.stringify(input);expect(detailFromCandidate(input,{exercise_id:"EX-1",checkpoint_revision:7,writer_instance_id:"writer-a"},{exercise_id:"EX-1",writer_instance_id:"writer-a",expires_at:"2999-01-01",released_at:null})).toMatchObject({exerciseId:"EX-1",checkpoint:"AVAILABLE",checkpointRevision:7,lease:"ACTIVE",recoveryEligible:false});expect(JSON.stringify(input)).toBe(before);});
  test("broken exercise recovery is available only with known missing checkpoint, inactive lease and no persisted Runtime",()=>{expect(detailFromCandidate(candidate("BROKEN","PAUSED","2026-01-01"))).toMatchObject({checkpoint:"MISSING",lease:"INACTIVE",recoveryEligible:true});expect(detailFromCandidate(candidate("LOCAL","RUNNING","2026-01-01",true))).toMatchObject({recoveryEligible:false});expect(detailFromCandidate(candidate("UNKNOWN","RUNNING","2026-01-01"),undefined,undefined,false)).toMatchObject({checkpoint:"UNKNOWN",lease:"UNKNOWN",recoveryEligible:false});});
  test("remaining conflict is typed until active count falls below two",()=>{expect(resolveCurrentExercise([candidate("A","RUNNING","1"),candidate("B","RUNNING","2")]).status).toBe("CONFLICT");expect(resolveCurrentExercise([candidate("A","COMPLETED","1"),candidate("B","RUNNING","2")]).status).toBe("SELECTED");expect(resolveCurrentExercise([candidate("A","COMPLETED","1"),candidate("B","COMPLETED","2")]).status).toBe("SELECTED");});
  test("conflict screen source requires authoritative refresh rather than a cached-only load",()=>{const source=fs.readFileSync(path.join(process.cwd(),"src/app/excon/active-exercise-conflict.tsx"),"utf8");expect(source).toContain("void refreshActiveExerciseConflict().then");});
  test("an explicit in-session selection remains the only publish owner while other conflicts remain",()=>{const source=fs.readFileSync(path.join(process.cwd(),"src/services/CloudSyncService.ts"),"utf8");expect(source).toContain("explicitlySelectedExerciseId");expect(source).toContain('remoteSelectionState = explicit ? "RESOLVED" : "CONFLICT"');expect(source).toContain("explicitlySelectedExerciseId = undefined");});
  test("cloud publication uses the selected canonical exercise identity",()=>{const source=fs.readFileSync(path.join(process.cwd(),"src/services/CloudSyncService.ts"),"utf8");expect(source).toContain("const exerciseId = getCanonicalExerciseSnapshot().exerciseId");expect(source).not.toContain("getCurrentExercise().id");});
  test("stale local candidates cannot override authoritative remote conflict ordering",()=>{const remote=resolveCurrentExercise([candidate("REMOTE-A","RUNNING","2"),candidate("REMOTE-B","RUNNING","3")]);expect(remote).toMatchObject({status:"CONFLICT",exerciseIds:["REMOTE-B","REMOTE-A"]});expect(JSON.stringify(remote)).not.toContain("STALE-LOCAL");});
});
