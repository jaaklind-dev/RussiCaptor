import type { SharedExerciseState } from "@/services/StatePersistenceService";
import { createRuntimeCheckpoint, isValidRuntimeCheckpoint, resolveAgainstValidatedLocalCheckpoint, resolveAuthoritativeCheckpoint } from "../RuntimeCheckpointAuthorityService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { assertRuntimeCheckpointClockConsistency } from "@/services/StatePersistenceService";

function state(exerciseId="EX-1", patientIds=["PT-1"]):SharedExerciseState {
  const payload = {};
  return {
    exerciseSession:{ exerciseId, lifecycleState:"RUNNING", simulationTimeSec:12, startedAtSimulationSec:0 } as never,
    patients:patientIds.map(id=>({id,name:id} as never)), assignments:[],transfers:[],questions:[],labs:[],imagingStudies:[],orders:[],notes:[],scenarioEvents:[],timelineEvents:[],
    persistedRuntimeStates:patientIds.map(patientId=>({schemaVersion:1,provenance:{exerciseId,patientId,packageId:"PKG",packageVersion:"1",packageHash:"pkg",definitionHash:"def",moduleCompositionHash:"modules"},capturedAtSimulationTimeSec:12,payload,payloadHash:sha256Text(stableJson(payload))} as never)),
  };
}

describe("WP-44B checkpoint authority resolver",()=>{
  test("higher valid revision wins independent of arrival order",()=>{
    const older=createRuntimeCheckpoint(state(),10); const newer=createRuntimeCheckpoint(state("EX-1",["PT-1","PT-2"]),12);
    expect(resolveAuthoritativeCheckpoint(newer,older)).toMatchObject({status:"LOCAL",checkpoint:{checkpointRevision:12}});
    expect(resolveAuthoritativeCheckpoint(older,newer)).toMatchObject({status:"REMOTE",checkpoint:{checkpointRevision:12}});
  });
  test("same revision and hash is equivalent",()=>{
    const checkpoint=createRuntimeCheckpoint(state(),12);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.payload)).toBe(true);
    expect(Object.isFrozen(checkpoint.payload.persistedRuntimeStates?.[0]?.payload)).toBe(true);
    expect(resolveAuthoritativeCheckpoint(checkpoint,structuredClone(checkpoint))).toMatchObject({status:"EQUIVALENT"});
  });
  test("validated local equivalent retains the local canonical payload",()=>{
    const checkpoint=createRuntimeCheckpoint(state(),12);
    const resolved=resolveAgainstValidatedLocalCheckpoint(checkpoint,structuredClone(checkpoint));
    expect(resolved).toEqual({status:"EQUIVALENT",checkpoint});
    expect(resolved.status === "EQUIVALENT" && resolved.checkpoint).toBe(checkpoint);
  });
  test("same revision with different valid payload fails closed",()=>{
    const a=createRuntimeCheckpoint(state("EX-1",["PT-A"]),12); const b=createRuntimeCheckpoint(state("EX-1",["PT-B"]),12);
    expect(resolveAuthoritativeCheckpoint(a,b)).toEqual({status:"CONFLICT",code:"CHECKPOINT_REVISION_DIVERGENCE"});
  });
  test("invalid higher revision cannot replace valid lower revision",()=>{
    const valid=createRuntimeCheckpoint(state(),10); const corrupt={...createRuntimeCheckpoint(state(),13),payloadHash:"corrupt"};
    expect(isValidRuntimeCheckpoint(corrupt)).toBe(false);
    expect(resolveAuthoritativeCheckpoint(valid,corrupt)).toMatchObject({status:"LOCAL",checkpoint:{checkpointRevision:10}});
  });
  test("inactive checkpoint still validates every Runtime payload and provenance",()=>{
    const inactive=state();
    inactive.exerciseSession={...inactive.exerciseSession,lifecycleState:"COMPLETED"} as never;
    const valid=createRuntimeCheckpoint(inactive,10);
    const corruptPayload={...valid,payload:{...valid.payload,persistedRuntimeStates:valid.payload.persistedRuntimeStates?.map(item=>({...item,payloadHash:"corrupt"}))}};
    const foreignProvenance={...valid,payload:{...valid.payload,persistedRuntimeStates:valid.payload.persistedRuntimeStates?.map(item=>({...item,provenance:{...item.provenance,exerciseId:"OTHER"}}))}};
    expect(isValidRuntimeCheckpoint(corruptPayload)).toBe(false);
    expect(isValidRuntimeCheckpoint(foreignProvenance)).toBe(false);
  });
  test("different exercise identities fail closed",()=>{
    expect(resolveAuthoritativeCheckpoint(createRuntimeCheckpoint(state("A"),1),createRuntimeCheckpoint(state("B"),2)))
      .toEqual({status:"CONFLICT",code:"REMOTE_SYNC_CONFLICT"});
  });
  test("active checkpoint requires materialized patients and persisted Runtime",()=>{
    const missing={...state(),patients:[],persistedRuntimeStates:[]};
    expect(()=>createRuntimeCheckpoint(missing,1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  });
  test("active checkpoint rejects missing, duplicate and foreign Runtime provenance",()=>{
    const valid=state("EX-1",["PT-1","PT-2"]); const first=valid.persistedRuntimeStates![0];
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[first]},1)).not.toThrow();
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[first,first]},1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[{...first,provenance:{...first.provenance,exerciseId:"OTHER"}}]},1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  });
  test("newer authoritative clock is validated internally, not against stale local clock",()=>{
    const stale=state();
    const remote=state();
    remote.exerciseSession={...remote.exerciseSession,simulationTimeSec:24} as never;
    remote.persistedRuntimeStates=remote.persistedRuntimeStates?.map(item=>({...item,capturedAtSimulationTimeSec:24,
      payload:{...item.payload,simulationTimeSec:24},payloadHash:sha256Text(stableJson({...item.payload,simulationTimeSec:24}))}));
    expect((stale.exerciseSession as {simulationTimeSec:number}).simulationTimeSec).toBe(12);
    expect(()=>assertRuntimeCheckpointClockConsistency(remote)).not.toThrow();
  });
  test("internally inconsistent authoritative clock remains fail-closed",()=>{
    const corrupt=state();
    corrupt.exerciseSession={...corrupt.exerciseSession,simulationTimeSec:24} as never;
    expect(()=>assertRuntimeCheckpointClockConsistency(corrupt)).toThrow("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
  });
});
